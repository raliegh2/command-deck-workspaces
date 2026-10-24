import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { redactSensitiveText } from './privacy.js';

/** Command Deck's own credentials: never handed to audited project code or external tools. */
const secretEnv = /^(COMMAND_DECK_|RENDER_|VERCEL_|SUPABASE_|OPS_SUPABASE_|DISCORD_|CRON_SECRET|ALERT_|HUB_)/i;

export function sanitizedEnv(extra: Record<string, string> = {}) {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !secretEnv.test(key)) env[key] = value;
  }
  return { ...env, ...extra };
}

/**
 * On Windows `npm` is a .cmd shim that execFile cannot run without a shell. Run npm's JS entry
 * point with node instead: from npm_execpath when started via `npm run`, otherwise from the
 * copy bundled next to node.exe.
 */
export async function npmCliPath() {
  if (process.platform !== 'win32') return null;
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((item): item is string => Boolean(item && item.endsWith('.js')));
  for (const candidate of candidates) {
    if (await fs.stat(candidate).then((stat) => stat.isFile(), () => false)) return candidate;
  }
  return null;
}

/** [command, prefixArgs] that run npm without a shell on every platform. */
export async function npmCommand(): Promise<[string, string[]]> {
  const cli = await npmCliPath();
  return cli ? [process.execPath, [cli]] : ['npm', []];
}

export interface ProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  outputTail: string;
}

function killTree(pid: number | undefined) {
  if (!pid) return;
  if (process.platform === 'win32') {
    // Killing only npm would leave its child (vitest, vite, ...) running.
    execFile('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true }, () => undefined);
  } else {
    try { process.kill(-pid, 'SIGKILL'); } catch { /* already exited */ }
  }
}

/**
 * Runs a program without a shell, with a hard timeout that kills the whole process tree.
 * Returns the full stdout (capped) and a redacted tail of combined output for reports.
 */
export function runProcess(command: string, args: string[], options: { cwd: string; timeoutMs: number; env?: Record<string, string>; maxStdout?: number }) {
  const maxStdout = options.maxStdout ?? 5 * 1024 * 1024;
  return new Promise<ProcessResult>((resolve) => {
    const started = Date.now();
    let stdout = '';
    let combined = '';
    let timedOut = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? sanitizedEnv(),
      windowsHide: true,
      shell: false,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const append = (chunk: Buffer, isStdout: boolean) => {
      const text = chunk.toString('utf8');
      if (isStdout && stdout.length < maxStdout) stdout += text;
      combined = (combined + text).slice(-20_000);
    };
    child.stdout.on('data', (chunk: Buffer) => append(chunk, true));
    child.stderr.on('data', (chunk: Buffer) => append(chunk, false));
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child.pid);
    }, options.timeoutMs);
    let finished = false;
    const finish = (exitCode: number | null) => {
      if (finished) return; // 'error' can be followed by 'close'
      finished = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        timedOut,
        durationMs: Date.now() - started,
        stdout,
        // eslint-disable-next-line no-control-regex
        outputTail: redactSensitiveText(combined.replace(/\u001b\[[0-9;]*m/g, '')).slice(-4000),
      });
    };
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code));
  });
}
