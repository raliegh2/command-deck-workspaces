import fs from 'node:fs/promises';
import path from 'node:path';
import { projectById } from '../server/projects.js';
import { runProcess, sanitizedEnv, type ProcessResult } from '../server/processes.js';

export const harnessNames = ['deepseek', 'codex', 'claude'] as const;
export type HarnessName = typeof harnessNames[number];

function paidHarnessesEnabled() {
  return process.env.COMMAND_DECK_ENABLE_PAID_HARNESSES === '1';
}

function harnessEnabled(harness: HarnessName) {
  return harness === 'deepseek' || paidHarnessesEnabled();
}

export interface HarnessStatus {
  harness: HarnessName;
  available: boolean;
  executable: string | null;
  version: string | null;
  authentication: 'local' | 'subscription' | 'missing' | 'unsupported';
  detail: string;
}

export interface HarnessResult {
  harness: HarnessName;
  role: string;
  status: 'complete' | 'unavailable' | 'failed' | 'timed-out';
  output: string;
  durationMs: number;
  exitCode: number | null;
  detail?: string;
}

type Runner = typeof runProcess;

const defaultRoles: Record<HarnessName, string> = {
  deepseek: 'Triage the request, identify the smallest useful plan, and flag ambiguity.',
  codex: 'Develop the implementation and verification approach, with concrete file-level guidance.',
  claude: 'Review the request for risks, missed edge cases, and ways to simplify the execution flow.',
};

const executableEnvironment: Record<HarnessName, string> = {
  deepseek: 'COMMAND_DECK_OLLAMA_CLI',
  codex: 'COMMAND_DECK_CODEX_CLI',
  claude: 'COMMAND_DECK_CLAUDE_CLI',
};

const executableNames: Record<HarnessName, string> = {
  deepseek: 'ollama',
  codex: 'codex',
  claude: 'claude',
};

const blockedCredentialVariables = new Set([
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'AZURE_OPENAI_API_KEY',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_USE_VERTEX',
  'DEEPSEEK_API_KEY',
  'GOOGLE_API_KEY',
  'OLLAMA_API_KEY',
  'OPENAI_API_KEY',
]);

function outputLimit() {
  const parsed = Number(process.env.COMMAND_DECK_HARNESS_MAX_OUTPUT_CHARS ?? 6000);
  return Number.isInteger(parsed) && parsed >= 1000 && parsed <= 20_000 ? parsed : 6000;
}

export function configuredDeepSeekModel() {
  const model = (process.env.COMMAND_DECK_DEEPSEEK_MODEL ?? 'deepseek-r1:1.5b').trim();
  return /^deepseek-r1:[a-zA-Z0-9._-]+$/.test(model) ? model : 'deepseek-r1:1.5b';
}

/** Harnesses inherit local CLI login state, but never provider API-key environment variables. */
export function harnessEnvironment() {
  const env = sanitizedEnv({ NO_COLOR: '1', TERM: 'dumb' });
  for (const name of Object.keys(env)) {
    if (
      blockedCredentialVariables.has(name)
      || /(?:^|_)(?:API_KEY|AUTH_TOKEN)$/.test(name)
      || /^(?:ANTHROPIC|AZURE|DEEPSEEK|GOOGLE|OLLAMA|OPENAI)_/.test(name)
      || /^AWS_(?:ACCESS|SECRET|SESSION|PROFILE)/.test(name)
    ) delete env[name];
  }
  return env;
}

async function isFile(candidate: string) {
  return fs.stat(candidate).then((item) => item.isFile(), () => false);
}

async function findOnPath(name: string) {
  const searchPath = process.env.Path ?? process.env.PATH ?? '';
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const directory of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory.replace(/^"|"$/g, ''), name + extension);
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

async function knownWindowsExecutable(harness: HarnessName) {
  if (process.platform !== 'win32') return null;
  const home = process.env.USERPROFILE ?? '';
  const local = process.env.LOCALAPPDATA ?? '';
  const direct = harness === 'deepseek'
    ? path.join(local, 'Programs', 'Ollama', 'ollama.exe')
    : harness === 'claude'
      ? path.join(home, '.local', 'bin', 'claude.exe')
      : '';
  if (direct && await isFile(direct)) return direct;

  if (harness === 'codex') {
    const binRoot = path.join(local, 'OpenAI', 'Codex', 'bin');
    const entries = await fs.readdir(binRoot, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const candidate = path.join(binRoot, entry.name, 'codex.exe');
      if (await isFile(candidate)) return candidate;
    }
  }
  return null;
}

export async function resolveHarnessExecutable(harness: HarnessName) {
  const configured = process.env[executableEnvironment[harness]]?.trim();
  if (configured) return path.isAbsolute(configured) && await isFile(configured) ? configured : null;
  return await findOnPath(executableNames[harness]) ?? await knownWindowsExecutable(harness);
}

function plainOutput(result: ProcessResult) {
  return (result.stdout.trim() || result.outputTail.trim()).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function claudeOutput(result: ProcessResult) {
  const output = plainOutput(result);
  try {
    const parsed = JSON.parse(output) as { result?: unknown };
    return typeof parsed.result === 'string' ? parsed.result : output;
  } catch {
    return output;
  }
}

export function compactHarnessOutput(value: string, limit = outputLimit()) {
  const clean = value.trim().replace(/\r\n/g, '\n');
  if (clean.length <= limit) return clean;
  const tailSize = Math.min(500, Math.floor(limit / 5));
  return clean.slice(0, limit - tailSize - 45).trimEnd()
    + `\n\n[Command Deck truncated ${clean.length - limit} characters]\n\n`
    + clean.slice(-tailSize).trimStart();
}

export function buildHarnessPrompt(harness: HarnessName, prompt: string, projectLabel?: string) {
  const context = projectLabel ? `Registered project: ${projectLabel}.` : 'No project was selected.';
  return [
    `You are the ${harness} advisory harness inside the local Command Deck MCP.`,
    'Work in read-only advisory mode. Do not edit files, run deployments, change configuration, or request credentials.',
    'Be concise. Return: recommendation, concrete next steps, verification, and blockers.',
    defaultRoles[harness],
    context,
    '',
    'Task:',
    prompt.trim(),
  ].join('\n');
}

export function buildHarnessArgs(harness: HarnessName, cwd: string, prompt: string) {
  if (harness === 'deepseek') {
    return ['run', configuredDeepSeekModel(), '--hidethinking', '--nowordwrap', '--keepalive', '5m', prompt];
  }
  if (harness === 'codex') {
    return [
      'exec', '--ephemeral', '--ignore-user-config', '--sandbox', 'read-only',
      '--skip-git-repo-check', '--color', 'never', '-c', 'approval_policy="never"',
      '-C', cwd, prompt,
    ];
  }
  return [
    '--print', '--output-format', 'json', '--no-session-persistence', '--restricted',
    '--safe-mode', '--permission-mode', 'plan', '--permission-prompts', 'none',
    '--no-chrome', prompt,
  ];
}

async function projectContext(projectId?: string) {
  if (!projectId) return { cwd: process.cwd(), label: undefined as string | undefined };
  const project = await projectById(projectId);
  if (!project) return { error: 'Project not found.' } as const;
  if (!project.root || !await fs.stat(project.root).then((item) => item.isDirectory(), () => false)) {
    return { error: 'The selected project does not have an available local workspace.' } as const;
  }
  return { cwd: path.resolve(project.root), label: `${project.name} (${project.id})` };
}

export async function getHarnessStatus(runner: Runner = runProcess): Promise<HarnessStatus[]> {
  return Promise.all(harnessNames.map(async (harness): Promise<HarnessStatus> => {
    if (!harnessEnabled(harness)) {
      return {
        harness,
        available: false,
        executable: null,
        version: null,
        authentication: 'unsupported',
        detail: `${harness} is disabled by the local-only harness policy.`,
      };
    }
    const executable = await resolveHarnessExecutable(harness);
    if (!executable) {
      return { harness, available: false, executable: null, version: null, authentication: 'missing', detail: `${harness} CLI was not found.` };
    }
    const cwd = process.cwd();
    const env = harnessEnvironment();
    const versionArgs = harness === 'deepseek' ? ['--version'] : ['--version'];
    const versionResult = await runner(executable, versionArgs, { cwd, timeoutMs: 10_000, env, maxStdout: 20_000 });
    const version = compactHarnessOutput(plainOutput(versionResult), 500) || null;
    if (versionResult.exitCode !== 0) {
      return { harness, available: false, executable, version, authentication: 'missing', detail: `${harness} CLI did not start successfully.` };
    }

    if (harness === 'deepseek') {
      const listed = await runner(executable, ['list'], { cwd, timeoutMs: 10_000, env, maxStdout: 100_000 });
      const model = configuredDeepSeekModel();
      const available = listed.exitCode === 0 && plainOutput(listed).includes(model);
      return { harness, available, executable, version, authentication: 'local', detail: available ? `Local model ${model} is installed.` : `Local model ${model} is not available.` };
    }

    if (harness === 'codex') {
      const auth = await runner(executable, ['login', 'status'], { cwd, timeoutMs: 10_000, env, maxStdout: 20_000 });
      const text = plainOutput(auth);
      const available = auth.exitCode === 0 && !/not logged in/i.test(text);
      return { harness, available, executable, version, authentication: available ? 'subscription' : 'missing', detail: available ? 'Codex CLI subscription/OAuth login is available.' : 'Run `codex login`; API-key fallback is disabled.' };
    }

    const auth = await runner(executable, ['auth', 'status'], { cwd, timeoutMs: 10_000, env, maxStdout: 20_000 });
    let loggedIn = false;
    let subscription = false;
    try {
      const parsed = JSON.parse(auth.stdout) as { loggedIn?: boolean; authMethod?: string };
      loggedIn = parsed.loggedIn === true;
      subscription = parsed.authMethod === 'claude.ai';
    } catch { /* Report a safe unavailable state below. */ }
    const available = auth.exitCode === 0 && loggedIn && subscription;
    return {
      harness,
      available,
      executable,
      version,
      authentication: available ? 'subscription' : loggedIn ? 'unsupported' : 'missing',
      detail: available ? 'Claude Code subscription login is present; entitlement is verified on the first consultation.' : 'Claude must be signed in through claude.ai; API-key auth is not accepted by this harness.',
    };
  }));
}

export async function runHarness(options: {
  harness: HarnessName;
  prompt: string;
  projectId?: string;
  role?: string;
  timeoutSeconds?: number;
}, runner: Runner = runProcess): Promise<HarnessResult> {
  const role = options.role?.trim() || defaultRoles[options.harness];
  if (!harnessEnabled(options.harness)) {
    return {
      harness: options.harness,
      role,
      status: 'unavailable',
      output: '',
      durationMs: 0,
      exitCode: null,
      detail: `${options.harness} is disabled by the local-only harness policy.`,
    };
  }
  const context = await projectContext(options.projectId);
  if ('error' in context) {
    return { harness: options.harness, role, status: 'unavailable', output: '', durationMs: 0, exitCode: null, detail: context.error };
  }
  const executable = await resolveHarnessExecutable(options.harness);
  if (!executable) {
    return { harness: options.harness, role, status: 'unavailable', output: '', durationMs: 0, exitCode: null, detail: `${options.harness} CLI was not found.` };
  }
  const timeoutSeconds = options.timeoutSeconds ?? (options.harness === 'deepseek' ? 240 : 300);
  const prompt = buildHarnessPrompt(options.harness, `${role}\n\n${options.prompt}`, context.label);
  const result = await runner(executable, buildHarnessArgs(options.harness, context.cwd, prompt), {
    cwd: context.cwd,
    timeoutMs: timeoutSeconds * 1000,
    env: harnessEnvironment(),
    maxStdout: 2 * 1024 * 1024,
  });
  const raw = options.harness === 'claude' ? claudeOutput(result) : plainOutput(result);
  const output = compactHarnessOutput(raw);
  if (result.timedOut) {
    return { harness: options.harness, role, status: 'timed-out', output, durationMs: result.durationMs, exitCode: result.exitCode, detail: `Stopped after ${timeoutSeconds} seconds.` };
  }
  if (result.exitCode !== 0) {
    if (options.harness === 'claude' && /organization has disabled Claude subscription access/i.test(output)) {
      return {
        harness: options.harness,
        role,
        status: 'unavailable',
        output: '',
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        detail: 'Claude Code subscription access is disabled for the signed-in organization. Enable subscription access in Claude administration; API-key fallback is intentionally disabled.',
      };
    }
    const login = options.harness === 'codex' && /not logged in|login/i.test(output)
      ? ' Run `codex login`; no API-key fallback is configured.'
      : '';
    return { harness: options.harness, role, status: 'failed', output, durationMs: result.durationMs, exitCode: result.exitCode, detail: `Harness exited unsuccessfully.${login}` };
  }
  return { harness: options.harness, role, status: 'complete', output, durationMs: result.durationMs, exitCode: result.exitCode };
}

export async function coordinateHarnesses(options: {
  prompt: string;
  projectId?: string;
  timeoutSeconds?: number;
}, runner: Runner = runProcess) {
  const enabledHarnesses = harnessNames.filter(harnessEnabled);
  const results = await Promise.all(enabledHarnesses.map((harness) => runHarness({
    harness,
    prompt: options.prompt,
    projectId: options.projectId,
    timeoutSeconds: options.timeoutSeconds,
  }, runner)));
  const completed = results.filter((item) => item.status === 'complete').map((item) => item.harness);
  return {
    mode: paidHarnessesEnabled() ? 'complementary-parallel' : 'local-deepseek-only',
    apiKeysUsed: false,
    completed,
    unavailable: results.filter((item) => item.status !== 'complete').map((item) => ({ harness: item.harness, status: item.status, detail: item.detail })),
    next: completed.length
      ? 'Use the complementary recommendations as one advisory packet; Command Deck remains responsible for guarded execution and review.'
      : 'No harness completed. Check harness_status before retrying.',
    results,
  };
}
