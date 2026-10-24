import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let root = '';
let audits: typeof import('./audits.js');

const pythonAvailable = (() => {
  try {
    execFileSync(process.platform === 'win32' ? 'py' : 'python3', [...(process.platform === 'win32' ? ['-3'] : []), '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

async function waitFor(projectId: string, job: string) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (!audits.runningAudits(projectId).some((item) => item.job === job)) return audits.projectAudits(projectId);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('audit did not finish');
}

async function project(name: string, scripts: Record<string, string>, options: { modules?: boolean } = {}) {
  const dir = path.join(root, name);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, private: true, scripts }), 'utf8');
  if (options.modules !== false) await fs.mkdir(path.join(dir, 'node_modules'), { recursive: true });
  return dir;
}

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'command-deck-audits-'));
  const configDir = path.join(root, 'config');
  await fs.mkdir(configDir);
  await fs.copyFile(path.resolve('config/operations.json'), path.join(configDir, 'operations.json'));
  await fs.copyFile(path.resolve('config/teams.json'), path.join(configDir, 'teams.json'));

  const node = 'node'; // npm puts node on PATH for scripts
  const ok = await project('app-ok', {
    test: `${node} -e "console.log('tests ok', process.env.COMMAND_DECK_TOKEN ?? 'no-token', process.env.CI)"`,
    build: `${node} -e "process.exit(0)"`,
    deploy: `${node} -e "require('fs').writeFileSync('deployed.txt', 'x')"`,
  });
  const failing = await project('app-failing', { test: `${node} -e "console.error('boom'); process.exit(3)"`, build: `${node} -e "process.exit(0)"` });
  const bare = await project('app-bare', { test: `${node} -e "process.exit(0)"` }, { modules: false });

  const webaudit = path.join(root, 'webaudit');
  await fs.mkdir(webaudit);
  const report = {
    tool: 'webaudit',
    results: [{
      url: 'https://app.example/', score: 77, grade: 'C', errors: [],
      findings: [
        { category: 'headers', id: 'missing-csp', severity: 'high', message: 'Content-Security-Policy header is missing' },
        { category: 'cookies', id: 'cookie-flags', severity: 'medium', message: "Cookie 'sid' is missing Secure" },
        { category: 'headers', id: 'server-banner', severity: 'info', message: 'Server banner disclosed' },
      ],
    }],
  };
  // A stand-in for webaudit.py that records its arguments and prints a fixed JSON report.
  await fs.writeFile(path.join(webaudit, 'webaudit.py'), [
    'import json, sys',
    `open(${JSON.stringify(path.join(root, 'webaudit-args.json'))}, "w").write(json.dumps(sys.argv[1:]))`,
    `print(json.dumps(json.loads(${JSON.stringify(JSON.stringify(report))})))`,
  ].join('\n'), 'utf8');

  const entry = (id: string, dir: string, extra: Record<string, unknown> = {}) => ({ id, name: id, kind: 'builder', root: dir, description: 'Fixture project', teamId: 'build-studio', allowedScripts: ['test', 'build'], ...extra });
  await fs.writeFile(path.join(configDir, 'projects.json'), JSON.stringify([
    entry('app-ok', ok, { healthUrl: 'http://127.0.0.1:4999/api/health' }),
    entry('app-failing', failing),
    entry('app-bare', bare),
    entry('malware-lab', webaudit, { allowedScripts: [] }),
  ]), 'utf8');
  await fs.writeFile(path.join(configDir, 'production.json'), JSON.stringify([{
    id: 'app-ok', projectId: 'app-ok', name: 'App OK', description: 'Fixture production app', root: ok,
    repositoryUrl: 'https://github.com/example/app-ok', repositoryConnection: 'github-connected',
    liveUrl: 'https://app.example/', previewMode: 'external-only', teamId: 'build-studio',
  }]), 'utf8');

  process.env.COMMAND_DECK_CONFIG_DIR = configDir;
  process.env.COMMAND_DECK_DATA_DIR = path.join(root, 'data');
  process.env.COMMAND_DECK_TOKEN = 'secret-token-that-must-not-leak-'.padEnd(40, 'x');
  audits = await import('./audits.js');
});

afterAll(async () => {
  await (await import('./security-program.js')).closeSecurityProgram();
  await fs.rm(root, { recursive: true, force: true });
});

describe('functional audits', () => {
  it('runs only allowed scripts that exist, with secrets stripped and CI set', async () => {
    const started = await audits.startFunctionalAudit('app-ok');
    expect(started.scripts).toEqual(['test', 'build']);
    const result = (await waitFor('app-ok', 'functional')).functional!;
    expect(result.status).toBe('pass');
    expect(result.scripts.map((item) => item.script)).toEqual(['test', 'build']);
    expect(result.scripts[0]!.outputTail).toContain('tests ok no-token true');
    expect(result.scripts[0]!.outputTail).not.toContain('secret-token');
    // "deploy" is defined but not allowed, so it must never run.
    await expect(fs.stat(path.join(root, 'app-ok', 'deployed.txt'))).rejects.toThrow();
  }, 60_000);

  it('reports failing scripts with their output', async () => {
    await audits.startFunctionalAudit('app-failing');
    const result = (await waitFor('app-failing', 'functional')).functional!;
    expect(result.status).toBe('action-needed');
    expect(result.scripts[0]).toMatchObject({ script: 'test', passed: false, exitCode: 3 });
    expect(result.scripts[0]!.outputTail).toContain('boom');
    expect(result.detail).toContain('test failed (exit 3)');
  }, 60_000);

  it('asks for npm install instead of running lifecycle scripts itself', async () => {
    await audits.startFunctionalAudit('app-bare');
    const result = (await waitFor('app-bare', 'functional')).functional!;
    expect(result.status).toBe('needs-setup');
    expect(result.detail).toContain('npm install');
  });

  it('refuses to run a script that is not allowed', async () => {
    await expect(audits.startFunctionalAudit('app-ok', ['lint'])).rejects.toThrow('No runnable scripts');
  });
});

describe('security audits', () => {
  it('only offers URLs from config', async () => {
    const report = await audits.auditReport('app-ok');
    expect(report.available.securityTargets).toEqual({ live: 'https://app.example/', local: 'http://127.0.0.1:4999/' });
    await expect(audits.startSecurityAudit('app-failing', 'live')).rejects.toThrow('no live URL');
  });

  it.skipIf(!pythonAvailable)('runs webaudit against the configured URL and summarizes its findings', async () => {
    await audits.startSecurityAudit('app-ok', 'live');
    const result = (await waitFor('app-ok', 'security:live')).security.live!;
    expect(JSON.parse(await fs.readFile(path.join(root, 'webaudit-args.json'), 'utf8'))).toEqual(['https://app.example/', '--format', 'json', '--timeout', '10']);
    expect(result).toMatchObject({ status: 'action-needed', grade: 'C', score: 77 });
    expect(result.counts).toMatchObject({ high: 1, medium: 1, info: 1 });
    expect(result.detail).toBe('webaudit grade C (77/100): 1 high, 1 medium.');
  }, 60_000);

  it.skipIf(!pythonAvailable)('explains missing Python dependencies', async () => {
    await fs.writeFile(path.join(root, 'webaudit', 'webaudit.py'), 'import requests_that_do_not_exist\n', 'utf8');
    await audits.startSecurityAudit('app-ok', 'local');
    const result = (await waitFor('app-ok', 'security:local')).security.local!;
    expect(result.status).toBe('needs-setup');
    expect(result.detail).toContain('pip install -r');
  }, 60_000);
});

describe('source reviews', () => {
  it('stores a redacted review that feeds the source gate', async () => {
    await audits.recordSourceReview('app-ok', {
      status: 'action-needed',
      summary: 'Reviewed auth flow; token=abcdef123456 found in config.',
      findings: [{ severity: 'high', title: 'Hard-coded token', file: 'src/config.ts:4' }],
    });
    const { source } = await audits.projectAudits('app-ok');
    expect(source).toMatchObject({ status: 'action-needed', reviewer: 'Claude via Command Deck MCP' });
    expect(source!.summary).not.toContain('abcdef123456');

    const { productionApps } = await import('./production.js');
    const [app] = await productionApps();
    const gates = Object.fromEntries(app!.audit.gates.map((gate) => [gate.id, gate]));
    expect(gates.source!.status).toBe('action-needed');
    expect(gates.build!.status).toBe('pass');
    if (pythonAvailable) expect(gates.headers).toMatchObject({ label: 'Web security audit', status: 'action-needed' });
  }, 60_000);
});
