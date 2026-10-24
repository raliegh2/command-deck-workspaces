import {existsSync} from 'node:fs';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { loadOperations, loadProductionApps } from './config.js';
import { PublicError } from './errors.js';
import { redactSensitiveText } from './privacy.js';
import { npmCommand, runProcess, sanitizedEnv } from './processes.js';
import { projectById } from './projects.js';
import type { ProjectConfig } from './types.js';

export type AuditStatus = 'pass' | 'action-needed' | 'failed' | 'needs-setup' | 'not-applicable';
export type SecurityTarget = 'live' | 'staging' | 'local';

export interface SecurityAudit {
  kind: 'security';
  target: SecurityTarget;
  url: string;
  ranAt: string;
  status: AuditStatus;
  detail: string;
  score: number | null;
  grade: string | null;
  counts: Record<'critical' | 'high' | 'medium' | 'low' | 'info', number>;
  findings: Array<{ severity: string; category: string; id: string; message: string }>;
}

export interface FunctionalAudit {
  kind: 'functional';
  ranAt: string;
  status: AuditStatus;
  detail: string;
  scripts: Array<{ script: string; passed: boolean; exitCode: number | null; timedOut: boolean; durationMs: number; outputTail: string }>;
}

export interface SourceReview {
  kind: 'source';
  recordedAt: string;
  status: 'pass' | 'action-needed';
  reviewer: string;
  summary: string;
  findings: Array<{ severity: 'critical' | 'high' | 'medium' | 'low' | 'info'; title: string; file?: string; detail?: string }>;
}

export interface ProjectAudits {
  security: Partial<Record<SecurityTarget, SecurityAudit>>;
  functional: FunctionalAudit | null;
  source: SourceReview | null;
}

// Resolved lazily so COMMAND_DECK_DATA_DIR (and tests) can redirect it.
function auditsPath() {
  const dir = process.env.COMMAND_DECK_DATA_DIR ? path.resolve(process.env.COMMAND_DECK_DATA_DIR) : path.resolve('data');
  return path.join(dir, 'audits.json');
}

let writeChain: Promise<unknown> = Promise.resolve();

async function readAll(): Promise<Record<string, ProjectAudits>> {
  try {
    return JSON.parse(await fs.readFile(auditsPath(), 'utf8')) as Record<string, ProjectAudits>;
  } catch {
    return {};
  }
}

/** Serialized read-modify-write so concurrent audits of different projects cannot overwrite each other. */
function update(projectId: string, change: (current: ProjectAudits) => void) {
  const next = writeChain.then(async () => {
    const all = await readAll();
    const current = all[projectId] ?? { security: {}, functional: null, source: null };
    change(current);
    all[projectId] = current;
    const file = auditsPath();
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = file + '.' + crypto.randomUUID() + '.tmp';
    await fs.writeFile(temporary, JSON.stringify(all), 'utf8');
    await fs.rename(temporary, file);
  });
  writeChain = next.catch(() => undefined);
  return next;
}

export async function projectAudits(projectId: string): Promise<ProjectAudits> {
  return (await readAll())[projectId] ?? { security: {}, functional: null, source: null };
}

/* ------------------------------------------------------------------ jobs */

/** Audits can outlast an HTTP request, so they run as jobs; callers poll the report for completion. */
const running = new Map<string, { kind: string; startedAt: string }>();

function startJob(key: string, kind: string, job: () => Promise<void>) {
  const existing = running.get(key);
  if (existing) return { started: false, ...existing };
  const entry = { kind, startedAt: new Date().toISOString() };
  running.set(key, entry);
  void job()
    .catch((error) => console.error(JSON.stringify({ level: 'error', event: 'audit_job_failed', kind, name: (error as Error)?.name })))
    .finally(() => running.delete(key));
  return { started: true, ...entry };
}

export function runningAudits(projectId: string) {
  return [...running.entries()].filter(([key]) => key.startsWith(projectId + ':')).map(([key, value]) => ({ job: key.slice(projectId.length + 1), ...value }));
}

async function requireProject(projectId: string) {
  const project = await projectById(projectId);
  if (!project) throw new PublicError('Project not found.', 404);
  return project;
}

/* -------------------------------------------------------------- security */

/** Only URLs already in Command Deck's config can be scanned; the API never accepts a raw target URL. */
export async function securityTargets(project: ProjectConfig): Promise<Partial<Record<SecurityTarget, string>>> {
  const [production, operations] = await Promise.all([loadProductionApps(), loadOperations()]);
  const app = production.find((item) => item.projectId === project.id);
  const targets: Partial<Record<SecurityTarget, string>> = {};
  if (app) targets.live = app.liveUrl;
  const staging = app ? operations.apps.find((item) => item.id === app.id)?.staging.url : null;
  if (staging) targets.staging = staging;
  if (project.healthUrl) {
    const url = new URL(project.healthUrl);
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') targets.local = url.origin + '/';
  }
  return targets;
}

async function webauditLocation() {
  const configured = process.env.COMMAND_DECK_WEBAUDIT_DIR;
  const toolkit = configured ? null : await projectById('malware-lab');
  const dir = configured ?? toolkit?.root ?? null;
  if (!dir) return null;
  const script = path.join(dir, 'webaudit.py');
  return await fs.stat(script).then((stat) => (stat.isFile() ? { dir, script } : null), () => null);
}

function pythonCommand(): [string, string[]] {
  if (process.env.COMMAND_DECK_PYTHON) return [process.env.COMMAND_DECK_PYTHON, []];
  const localPython=path.resolve('.venv-tools',process.platform === 'win32'?'Scripts/python.exe':'bin/python');
  if(existsSync(localPython))return [localPython,[]];
  return process.platform === 'win32' ? ['py', ['-3']] : ['python3', []];
}

const severities = ['critical', 'high', 'medium', 'low', 'info'] as const;
const webauditReport = z.object({
  results: z.array(z.object({
    url: z.string(),
    score: z.number().nullable().optional(),
    grade: z.string().nullable().optional(),
    findings: z.array(z.object({ severity: z.string().optional(), category: z.string().optional(), id: z.string().optional(), message: z.string().optional() }).passthrough()).default([]),
    errors: z.array(z.string()).default([]),
  })).min(1),
});

async function scanWithWebaudit(target: SecurityTarget, url: string): Promise<SecurityAudit> {
  const base = { kind: 'security' as const, target, url, ranAt: new Date().toISOString(), score: null, grade: null, counts: { critical: 0, high: 0, medium: 0, low: 0, info: 0 }, findings: [] };
  const location = await webauditLocation();
  if (!location) {
    return { ...base, status: 'needs-setup', detail: 'webaudit.py was not found. Register the webaudit checkout as the "malware-lab" project or set COMMAND_DECK_WEBAUDIT_DIR.' };
  }
  const [python, prefix] = pythonCommand();
  const result = await runProcess(python, [...prefix, location.script, url, '--format', 'json', '--timeout', '10'], {
    cwd: location.dir,
    timeoutMs: 180_000,
    env: sanitizedEnv({ PYTHONIOENCODING: 'utf-8' }),
  });
  if (result.exitCode === null && !result.timedOut) {
    return { ...base, status: 'needs-setup', detail: `Python could not be started ("${python}"). Install Python 3 or set COMMAND_DECK_PYTHON.` };
  }
  if (/No module named/.test(result.outputTail)) {
    return { ...base, status: 'needs-setup', detail: `webaudit's Python dependencies are missing. Install them with: ${python === 'py' ? 'py -3' : python} -m pip install -r "${path.join(location.dir, 'requirements.txt')}"` };
  }
  if (result.timedOut) return { ...base, status: 'failed', detail: 'webaudit did not finish within 3 minutes.' };
  let report: z.infer<typeof webauditReport>;
  try {
    report = webauditReport.parse(JSON.parse(result.stdout));
  } catch {
    return { ...base, status: 'failed', detail: 'webaudit did not return a readable JSON report. ' + result.outputTail.slice(-300) };
  }
  const scan = report.results[0]!;
  const findings = scan.findings.map((finding) => ({
    severity: severities.includes(finding.severity as typeof severities[number]) ? finding.severity! : 'info',
    category: finding.category ?? 'general',
    id: finding.id ?? 'finding',
    message: redactSensitiveText(finding.message ?? '').slice(0, 500),
  }));
  const counts = { ...base.counts };
  for (const finding of findings) counts[finding.severity as keyof typeof counts] += 1;
  const connected = scan.errors.length === 0 || findings.length > 0;
  const status: AuditStatus = !connected ? 'failed' : counts.critical + counts.high > 0 ? 'action-needed' : 'pass';
  const summary = severities.filter((level) => counts[level] > 0 && level !== 'info').map((level) => `${counts[level]} ${level}`).join(', ') || 'no issues above info';
  return {
    ...base,
    score: scan.score ?? null,
    grade: scan.grade ?? null,
    counts,
    findings: findings.slice(0, 60),
    status,
    detail: connected
      ? `webaudit grade ${scan.grade ?? '?'} (${scan.score ?? '?'}/100): ${summary}.`
      : 'webaudit could not connect: ' + redactSensitiveText(scan.errors[0] ?? 'unknown error').slice(0, 300),
  };
}

export async function startSecurityAudit(projectId: string, target: SecurityTarget) {
  const project = await requireProject(projectId);
  const url = (await securityTargets(project))[target];
  if (!url) throw new PublicError(`This project has no ${target} URL configured. Available targets come from config/production.json, config/operations.json (staging) and a loopback healthUrl (local).`);
  return startJob(`${projectId}:security:${target}`, 'security', async () => {
    const audit = await scanWithWebaudit(target, url);
    await update(projectId, (current) => { current.security[target] = audit; });
  });
}

/* ------------------------------------------------------------ functional */

/** Script names a project may be allowed to run. Arbitrary names cannot be registered through the API. */
export const auditableScripts = ['test', 'build', 'lint', 'typecheck', 'check'] as const;
const perScriptTimeoutMs = 5 * 60_000;
const totalBudgetMs = 12 * 60_000;

export async function functionalPlan(project: ProjectConfig, requested?: string[]) {
  if (!project.root) return { scripts: [] as string[], reason: 'This project has no local path registered.' };
  const manifest = await fs.readFile(path.join(project.root, 'package.json'), 'utf8').then((raw) => JSON.parse(raw) as { scripts?: Record<string, string> }, () => null);
  if (!manifest) return { scripts: [], reason: 'No package.json: functional audits currently run npm scripts only.' };
  const defined = new Set(Object.keys(manifest.scripts ?? {}));
  const allowed = project.allowedScripts.filter((script) => defined.has(script));
  const scripts = requested?.length ? allowed.filter((script) => requested.includes(script)) : allowed;
  if (scripts.length === 0) {
    return { scripts, reason: `No runnable scripts. Allowed in config: [${project.allowedScripts.join(', ')}]; defined in package.json: [${[...defined].join(', ')}].` };
  }
  return { scripts, reason: '' };
}

async function runFunctional(project: ProjectConfig, scripts: string[]): Promise<FunctionalAudit> {
  const ranAt = new Date().toISOString();
  const hasModules = await fs.stat(path.join(project.root!, 'node_modules')).then((stat) => stat.isDirectory(), () => false);
  if (!hasModules) {
    // Installing would run third-party lifecycle scripts, so it stays a deliberate operator step.
    return { kind: 'functional', ranAt, status: 'needs-setup', detail: 'Dependencies are not installed. Run "npm install" in the project, then audit again.', scripts: [] };
  }
  const [npm, prefix] = await npmCommand();
  const results: FunctionalAudit['scripts'] = [];
  const started = Date.now();
  for (const script of scripts) {
    const remaining = totalBudgetMs - (Date.now() - started);
    if (remaining < 10_000) break;
    const result = await runProcess(npm, [...prefix, 'run', script], {
      cwd: project.root!,
      timeoutMs: Math.min(perScriptTimeoutMs, remaining),
      // CI=true keeps test runners out of watch mode; secrets are stripped by sanitizedEnv.
      env: sanitizedEnv({ CI: 'true', FORCE_COLOR: '0', NO_COLOR: '1' }),
    });
    results.push({ script, passed: result.exitCode === 0 && !result.timedOut, exitCode: result.exitCode, timedOut: result.timedOut, durationMs: result.durationMs, outputTail: result.outputTail });
  }
  const skipped = scripts.slice(results.length);
  const failed = results.filter((item) => !item.passed);
  const detail = [
    results.map((item) => `${item.script} ${item.passed ? 'passed' : item.timedOut ? 'timed out' : `failed (exit ${item.exitCode})`}`).join(', '),
    skipped.length ? `skipped (time budget): ${skipped.join(', ')}` : '',
  ].filter(Boolean).join('; ');
  return { kind: 'functional', ranAt, status: failed.length || skipped.length ? 'action-needed' : 'pass', detail, scripts: results };
}

export async function startFunctionalAudit(projectId: string, requested?: string[]) {
  const project = await requireProject(projectId);
  const plan = await functionalPlan(project, requested);
  if (plan.scripts.length === 0) throw new PublicError(plan.reason);
  return { scripts: plan.scripts, ...startJob(`${projectId}:functional`, 'functional', async () => {
    const audit = await runFunctional(project, plan.scripts);
    await update(projectId, (current) => { current.functional = audit; });
  }) };
}

/* ---------------------------------------------------------------- source */

export const sourceReviewSchema = z.object({
  status: z.enum(['pass', 'action-needed']),
  summary: z.string().min(10).max(4000),
  reviewer: z.string().min(2).max(100).default('Claude via Command Deck MCP'),
  findings: z.array(z.object({
    severity: z.enum(severities),
    title: z.string().min(3).max(200),
    file: z.string().max(300).optional(),
    detail: z.string().max(2000).optional(),
  })).max(100).default([]),
});

export async function recordSourceReview(projectId: string, input: z.input<typeof sourceReviewSchema>) {
  await requireProject(projectId);
  const parsed = sourceReviewSchema.parse(input);
  const review: SourceReview = {
    kind: 'source',
    recordedAt: new Date().toISOString(),
    status: parsed.status,
    reviewer: redactSensitiveText(parsed.reviewer),
    summary: redactSensitiveText(parsed.summary),
    findings: parsed.findings.map((finding) => ({
      severity: finding.severity,
      title: redactSensitiveText(finding.title),
      ...(finding.file ? { file: redactSensitiveText(finding.file) } : {}),
      ...(finding.detail ? { detail: redactSensitiveText(finding.detail) } : {}),
    })),
  };
  await update(projectId, (current) => { current.source = review; });
  return review;
}

/* ---------------------------------------------------------------- report */

export async function auditReport(projectId: string) {
  const project = await requireProject(projectId);
  const [audits, targets, plan] = await Promise.all([projectAudits(projectId), securityTargets(project), functionalPlan(project)]);
  return {
    projectId,
    running: runningAudits(projectId),
    available: { securityTargets: targets, functionalScripts: plan.scripts, functionalNote: plan.reason || undefined },
    ...audits,
  };
}
