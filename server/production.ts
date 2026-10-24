import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import { loadProductionApps, loadTeams } from './config.js';
import { projectAudits, type AuditStatus, type ProjectAudits } from './audits.js';
import { PublicError } from './errors.js';
import { npmCliPath, sanitizedEnv } from './processes.js';
import type { ProductionAppConfig, ProductionAppView, ProductionAudit, ProductionGate } from './types.js';
import {securityBaselineGate} from './security-program.js';

type DependencyAudit = ProductionAudit['vulnerabilities'] & {
  status: 'pass' | 'action-needed' | 'not-run' | 'not-applicable';
  detail: string;
  findings: ProductionAudit['dependencyFindings'];
};

interface CachedAudit {
  lastRun: string;
  dependencies: DependencyAudit;
}

const auditPath = path.resolve('data/production-audits.json');
const runningAudits = new Map<string, Promise<ProductionAppView>>();

async function command(command: string, args: string[], cwd: string, timeout = 12_000) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(command, args, { cwd, timeout, windowsHide: true, maxBuffer: 5 * 1024 * 1024, env: sanitizedEnv() }, (error, stdout, stderr) => {
      const code = typeof (error as NodeJS.ErrnoException | null)?.code === 'number'
        ? Number((error as NodeJS.ErrnoException).code)
        : error ? 1 : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

async function cachedAudits(): Promise<Record<string, CachedAudit>> {
  try {
    return JSON.parse(await fs.readFile(auditPath, 'utf8')) as Record<string, CachedAudit>;
  } catch {
    return {};
  }
}

async function saveCachedAudits(value: Record<string, CachedAudit>) {
  await fs.mkdir(path.dirname(auditPath), { recursive: true });
  const temporary = auditPath + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temporary, auditPath);
}

async function inspectRepository(app: ProductionAppConfig) {
  const stat = await fs.stat(app.root).catch(() => null);
  const exists = Boolean(stat?.isDirectory());
  if (!exists) return { exists: false, isGit: false, dirty: false, branch: null };
  const isGit = Boolean((await fs.stat(path.join(app.root, '.git')).catch(() => null)));
  if (!isGit) return { exists: true, isGit: false, dirty: false, branch: null };
  const [status, branch] = await Promise.all([
    command('git', ['status', '--porcelain'], app.root),
    command('git', ['branch', '--show-current'], app.root),
  ]);
  return {
    exists: true,
    isGit: true,
    dirty: status.code === 0 && status.stdout.trim().length > 0,
    branch: branch.code === 0 ? branch.stdout.trim() || null : null,
  };
}

async function inspectLive(app: ProductionAppConfig) {
  const checkedAt = new Date().toISOString();
  try {
    const response = await fetch(app.liveUrl, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: { 'user-agent': 'Command-Deck-Production-Audit/1.0' },
    });
    const csp = response.headers.get('content-security-policy') ?? '';
    const frameOptions = response.headers.get('x-frame-options') ?? '';
    const headers = {
      csp: Boolean(csp),
      hsts: Boolean(response.headers.get('strict-transport-security')),
      contentType: Boolean(response.headers.get('x-content-type-options')),
      referrer: Boolean(response.headers.get('referrer-policy')),
    };
    const embedded = app.previewMode === 'iframe' && !frameOptions && !/frame-ancestors\s+['"]?none/i.test(csp);
    await response.body?.cancel();
    return {
      online: response.ok,
      statusCode: response.status,
      finalUrl: response.url || app.liveUrl,
      checkedAt,
      embedded,
      headers,
    };
  } catch {
    return {
      online: false,
      statusCode: null,
      finalUrl: app.liveUrl,
      checkedAt,
      embedded: false,
      headers: { csp: false, hsts: false, contentType: false, referrer: false },
    };
  }
}

function emptyVulnerabilities(): ProductionAudit['vulnerabilities'] {
  return { critical: 0, high: 0, moderate: 0, low: 0, info: 0, total: 0 };
}
export function dependencyAuditCounts(report:unknown,exitCode:number):ProductionAudit['vulnerabilities'] {
  const count=z.number().int().nonnegative();
  const counts=z.object({metadata:z.object({vulnerabilities:z.object({critical:count,high:count,moderate:count,low:count,info:count,total:count})})}).parse(report).metadata.vulnerabilities;
  if(![0,1].includes(exitCode)||counts.total!==counts.critical+counts.high+counts.moderate+counts.low+counts.info)throw new Error('Dependency audit evidence is incomplete');
  return counts;
}

async function runDependencyAudit(app: ProductionAppConfig): Promise<DependencyAudit> {
  const lockExists = await Promise.any([
    fs.stat(path.join(app.root, 'package-lock.json')),
    fs.stat(path.join(app.root, 'npm-shrinkwrap.json')),
  ]).then(() => true).catch(() => false);
  if (!lockExists) {
    return { ...emptyVulnerabilities(), status: 'not-applicable', detail: 'No npm lockfile is present in this repository.', findings: [] };
  }
  const npmArgs = ['audit', '--omit=dev', '--json'];
  const npmCli = await npmCliPath();
  const result = npmCli
    ? await command(process.execPath, [npmCli, ...npmArgs], app.root, 120_000)
    : await command('npm', npmArgs, app.root, 120_000);
  try {
    const report = JSON.parse(result.stdout) as {
      metadata?: { vulnerabilities?: Partial<ProductionAudit['vulnerabilities']> };
      vulnerabilities?: Record<string, {
        severity?: ProductionAudit['dependencyFindings'][number]['severity'];
        via?: Array<string | { title?: string; url?: string; cwe?: string[] }>;
        fixAvailable?: boolean | object;
      }>;
    };
    const vulnerabilities = dependencyAuditCounts(report,result.code);
    const findings = Object.entries(report.vulnerabilities ?? {}).flatMap(([packageName, vulnerability]) =>
      (vulnerability.via ?? []).filter((item): item is { title?: string; url?: string; cwe?: string[] } => typeof item !== 'string').map((item) => ({
        package: packageName,
        title: item.title ?? `Known vulnerability in ${packageName}`,
        severity: vulnerability.severity ?? 'moderate',
        cwe: item.cwe ?? [],
        url: item.url ?? '',
        fixAvailable: vulnerability.fixAvailable !== false,
      })),
    ).slice(0, 25);
    return {
      ...vulnerabilities,
      findings,
      status: vulnerabilities.total > 0 ? 'action-needed' : 'pass',
      detail: vulnerabilities.total > 0
        ? `${vulnerabilities.total} production dependency ${vulnerabilities.total === 1 ? 'vulnerability' : 'vulnerabilities'} reported by npm audit.`
        : 'npm audit found no known production dependency vulnerabilities.',
    };
  } catch {
    return { ...emptyVulnerabilities(), status: 'not-run', detail: 'npm audit did not return a readable report.', findings: [] };
  }
}

function gateStatus(status: AuditStatus): ProductionGate['status'] {
  if (status === 'pass' || status === 'not-applicable') return status;
  return status === 'needs-setup' ? 'not-run' : 'action-needed';
}

function assembleAudit(
  app: ProductionAppConfig,
  repository: Awaited<ReturnType<typeof inspectRepository>>,
  live: Awaited<ReturnType<typeof inspectLive>>,
  cached?: CachedAudit,
  audits?: ProjectAudits,
): ProductionAudit {
  const headerCount = Object.values(live.headers).filter(Boolean).length;
  const dependencies = cached?.dependencies ?? {
    ...emptyVulnerabilities(),
    status: 'not-run' as const,
    detail: 'Run the audit to check production npm dependencies.',
    findings: [],
  };
  const gates: ProductionGate[] = [
    {
      id: 'live',
      label: 'Live reachability',
      status: live.online ? 'pass' : 'action-needed',
      detail: live.online ? `HTTPS returned ${live.statusCode}.` : 'The configured production URL did not respond successfully.',
    },
    {
      id: 'repository',
      label: 'Repository state',
      status: !repository.exists || !repository.isGit || repository.dirty || app.repositoryConnection === 'private-unverified' ? 'action-needed' : 'pass',
      detail: !repository.exists
        ? 'The configured local checkout is unavailable.'
        : !repository.isGit
          ? 'The configured local checkout is not a Git repository.'
          : repository.dirty
            ? 'The local checkout has uncommitted work; files and values are intentionally not exposed here.'
            : app.repositoryConnection === 'private-unverified'
              ? 'The local checkout is connected, but the GitHub remote could not be verified publicly.'
              : `Clean local checkout on ${repository.branch ?? 'an unnamed branch'}.`,
    },
    { id: 'dependencies', label: 'Dependency audit', status: dependencies.status, detail: dependencies.detail },
    // A webaudit scan of the live URL (headers, TLS, cookies, CORS, exposed paths) supersedes the header-presence check.
    audits?.security.live
      ? { id: 'headers', label: 'Web security audit', status: gateStatus(audits.security.live.status), detail: `${audits.security.live.detail} Scanned ${audits.security.live.ranAt}.` }
      : {
        id: 'headers',
        label: 'Security headers',
        status: live.online && headerCount === 4 ? 'pass' : 'action-needed',
        detail: live.online
          ? `${headerCount} of 4 baseline browser security headers were observed (CSP, HSTS, nosniff, referrer policy). Run a security audit for TLS, cookie, CORS and exposure checks.`
          : 'Headers could not be evaluated while the live app was unreachable.',
      },
    audits?.functional
      ? { id: 'build', label: 'Build verification', status: gateStatus(audits.functional.status), detail: `${audits.functional.detail} Ran ${audits.functional.ranAt}.` }
      : { id: 'build', label: 'Build verification', status: 'not-run', detail: 'Run a functional audit to execute the project\'s approved test and build scripts.' },
    audits?.source
      ? { id: 'source', label: 'Source review', status: audits.source.status, detail: `${audits.source.reviewer}: ${audits.source.summary.slice(0, 300)} (${audits.source.findings.length} findings, ${audits.source.recordedAt})` }
      : { id: 'source', label: 'Source review', status: 'not-run', detail: 'Ask Claude (Command Deck MCP) to review the source and record it with record_source_review.' },
  ];
  const status = gates.some((gate) => gate.status === 'action-needed')
    ? 'action-needed'
    : gates.some((gate) => gate.status === 'not-run') ? 'review' : 'ready';
  return { status, lastRun: cached?.lastRun ?? null, gates, vulnerabilities: dependencies, dependencyFindings: dependencies.findings ?? [] };
}

const liveTtlMs = 60_000;
const liveCache = new Map<string, { at: number; value: ReturnType<typeof inspectLive> }>();

/** Live checks take up to 15s per site, so results are reused briefly unless a refresh is requested. */
function cachedLive(app: ProductionAppConfig, fresh: boolean) {
  const hit = liveCache.get(app.id);
  if (!fresh && hit && Date.now() - hit.at < liveTtlMs) return hit.value;
  const value = inspectLive(app);
  liveCache.set(app.id, { at: Date.now(), value });
  return value;
}

async function viewFor(app: ProductionAppConfig, cached: Record<string, CachedAudit>, fresh = false): Promise<ProductionAppView> {
  const [repository, live, teams, audits] = await Promise.all([inspectRepository(app), cachedLive(app, fresh), loadTeams(), projectAudits(app.projectId)]);
  const team = teams.find((item) => item.id === app.teamId);
  const audit=assembleAudit(app,repository,live,cached[app.id],audits);
  try{audit.gates.push(await securityBaselineGate(app.projectId));}catch{audit.gates.push({id:'security-operations',label:'Security operations baseline',status:'action-needed',detail:'Security evidence storage is unavailable; baseline cannot be assessed.'});}
  if(audit.gates.some(g=>g.status==='action-needed'))audit.status='action-needed';else if(audit.gates.some(g=>g.status==='not-run'))audit.status='review';
  return {
    ...app,
    teamName: team?.name ?? app.teamId,
    teamRoles: team?.roles ?? [],
    repository,
    live: {
      online: live.online,
      statusCode: live.statusCode,
      finalUrl: live.finalUrl,
      checkedAt: live.checkedAt,
      embedded: live.embedded,
    },
    audit,
  };
}

export async function productionApps(options: { fresh?: boolean } = {}): Promise<ProductionAppView[]> {
  const [apps, cached] = await Promise.all([loadProductionApps(), cachedAudits()]);
  return Promise.all(apps.map((app) => viewFor(app, cached, options.fresh)));
}

export async function productionApp(id: string) {
  const apps = await loadProductionApps();
  return apps.find((app) => app.id === id) ?? null;
}

export async function auditProductionApp(id: string): Promise<ProductionAppView> {
  const running = runningAudits.get(id);
  if (running) return running;
  const task = (async () => {
    const app = await productionApp(id);
    if (!app) throw new PublicError('Production system not found.', 404);
    const dependencies = await runDependencyAudit(app);
    const cached = await cachedAudits();
    cached[id] = { lastRun: new Date().toISOString(), dependencies };
    await saveCachedAudits(cached);
    return viewFor(app, cached, true);
  })();
  runningAudits.set(id, task);
  try {
    return await task;
  } finally {
    runningAudits.delete(id);
  }
}
