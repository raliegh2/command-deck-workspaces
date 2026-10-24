import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { loadProjects } from './config.js';
import { PublicError } from './errors.js';
import { inspectGitStatus } from './git-status.js';
import type { ProjectConfig, ProjectView } from './types.js';

const execFileAsync = promisify(execFile);
const blockedParts = new Set(['.git', 'node_modules', '.supabase', 'uploads', 'exports', 'backups', 'dumps', 'customer-data', '.ssh', '.aws', '.azure', '.gnupg', '.docker', '.kube', '.vercel']);
const skippedDirectories = new Set([...blockedParts, 'dist', 'build', '.next', 'coverage', '.cache']);
const textExtensions = new Set(['.js', '.jsx', '.ts', '.tsx', '.json', '.md', '.css', '.scss', '.html', '.yaml', '.yml', '.toml', '.txt', '.py', '.ps1', '.sh', '.sql']);
/** Extension-less files that are plain source and safe to show. */
const textNames = new Set(['readme', 'license', 'dockerfile', 'makefile', 'procfile', '.gitignore', '.gitattributes', '.editorconfig', '.nvmrc', '.prettierrc', '.eslintrc']);
const blockedExtensions = new Set(['.pem', '.key', '.p12', '.pfx', '.crt', '.cer', '.der', '.dump', '.bak', '.sqlite', '.sqlite3', '.db', '.env', '.ppk', '.jks', '.keystore', '.kdbx', '.gpg', '.asc', '.ovpn', '.tfstate']);
/** File names that conventionally hold credentials even though their extension looks harmless. */
const blockedNames = /^(?:\.env(?:\..*)?|\.envrc|\.npmrc|\.yarnrc(?:\.yml)?|\.pypirc|\.netrc|_netrc|\.git-credentials|\.htpasswd|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|credentials(?:\.json)?|secrets?\.(?:json|ya?ml|toml)|service[-_]?account.*\.json|.*\.secret)$/i;
const maxFileBytes = 1_000_000;
const inspectTtlMs = 30_000;

let inspectCache: { at: number; value: Promise<ProjectView[]> } | null = null;

/** Project status (git state + health probes) is cached briefly; every dashboard load used to re-run it. */
export function inspectProjects(options: { fresh?: boolean } = {}): Promise<ProjectView[]> {
  if (!options.fresh && inspectCache && Date.now() - inspectCache.at < inspectTtlMs) return inspectCache.value;
  const value = loadProjects().then((projects) => Promise.all(projects.map(inspectProject)));
  inspectCache = { at: Date.now(), value };
  value.catch(() => { if (inspectCache?.value === value) inspectCache = null; });
  return value;
}

export function invalidateProjectCache() {
  inspectCache = null;
}

export async function projectById(id: string) {
  const projects = await loadProjects();
  return projects.find((project) => project.id === id) ?? null;
}

async function inspectProject(project: ProjectConfig): Promise<ProjectView> {
  const rootStat = project.root ? await fs.stat(project.root).catch(() => null) : null;
  const exists = Boolean(rootStat?.isDirectory());
  const gitStat = exists ? await fs.stat(path.join(project.root!, '.git')).catch(() => null) : null;
  const isGit = Boolean(gitStat);
  const [gitResult, health] = await Promise.all([
    isGit
      ? inspectGitStatus(project.root!)
      : Promise.resolve(null),
    project.healthUrl
      // Hosted free tiers can take several seconds to wake, so a short timeout reported them offline.
      ? fetch(project.healthUrl, { signal: AbortSignal.timeout(5000) })
        .then((response) => { void response.body?.cancel(); return response.ok ? 'online' as const : 'offline' as const; })
        .catch(() => 'offline' as const)
      : Promise.resolve('not-configured' as const),
  ]);
  const dirty = gitResult?.dirty ?? false;
  const state: ProjectView['state'] = !exists
    ? 'needs-setup'
    : health === 'online'
      ? 'connected'
      : project.kind === 'integration'
        ? 'paused'
        : 'ready';
  return {
    ...project,
    exists,
    isGit,
    dirty,
    gitStatus: gitResult,
    health,
    state,
    workspaceLabel: project.root ? compactPath(project.root) : 'Path not registered',
    lastActivity: !exists ? 'Environment not configured' : dirty ? 'Local changes detected' : health === 'online' ? 'Service responding' : 'Workspace available',
  };
}

function compactPath(input: string) {
  const normalized = input.replaceAll('\\', '/');
  const parts = normalized.split('/');
  return parts.length > 4 ? '…/' + parts.slice(-3).join('/') : normalized;
}

function isProtectedSegment(segment: string) {
  const lower = segment.toLowerCase();
  return blockedParts.has(lower) || blockedNames.test(lower) || blockedExtensions.has(path.extname(lower));
}

function isReadableName(name: string) {
  const lower = name.toLowerCase();
  return textExtensions.has(path.extname(lower)) || textNames.has(lower);
}

function isOutside(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative.startsWith('..') || path.isAbsolute(relative);
}

export async function safeProjectPath(project: ProjectConfig, relativePath: string, options: { forWrite?: boolean } = {}) {
  if (!project.root) throw new PublicError('This project does not have a registered local path.');
  const normalized = relativePath.replaceAll('\\', '/').replace(/^\/+/, '');
  if (!normalized || path.isAbsolute(normalized)) throw new PublicError('A project-relative path is required.');
  const parts = normalized.split('/').filter(Boolean);
  // ':' opens NTFS alternate data streams (".env::$DATA"), '~N' is an 8.3 short name ("ENV~1"),
  // and trailing dots/spaces are silently stripped by Windows. All three can alias a protected file.
  if (parts.some((part) => part.includes(':') || /~\d/.test(part) || (/[. ]$/.test(part) && part !== '.' && part !== '..'))) {
    throw new PublicError('That path is protected.');
  }
  if (parts.some(isProtectedSegment)) throw new PublicError('That path is protected.');
  const fileName = parts.at(-1) ?? '';
  if (!isReadableName(fileName)) {
    throw new PublicError(options.forWrite ? 'Only reviewed text-based source files can be changed.' : 'Only text-based source files can be opened.');
  }
  if (options.forWrite && !textExtensions.has(path.extname(fileName).toLowerCase())) {
    throw new PublicError('Only reviewed text-based source files can be changed.');
  }
  const root = path.resolve(project.root);
  const target = path.resolve(root, normalized);
  if (isOutside(root, target)) throw new PublicError('The path escaped the registered project root.');
  // Re-check the path the OS actually resolves to: this catches symlinks, junctions, and any
  // alias that expands to a protected long name.
  const realRoot = await fs.realpath(root);
  const realExisting = await fs.realpath(await nearestExistingParent(target));
  if (isOutside(realRoot, realExisting)) throw new PublicError('Symlink or junction escape rejected.');
  if (path.relative(realRoot, realExisting).split(/[\\/]/).filter(Boolean).some(isProtectedSegment)) {
    throw new PublicError('That path is protected.');
  }
  return { root, target, relative: parts.join('/') };
}

async function nearestExistingParent(target: string): Promise<string> {
  let cursor = target;
  while (true) {
    try {
      await fs.lstat(cursor);
      return cursor;
    } catch {
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new PublicError('No valid project parent was found.');
      cursor = parent;
    }
  }
}

export async function listProjectFiles(project: ProjectConfig, maxDepth = 3) {
  if (!project.root) return [];
  const output: Array<{ path: string; type: 'file' | 'directory' }> = [];
  async function walk(directory: string, depth: number) {
    if (depth > maxDepth || output.length >= 400) return;
    // An unreadable sub-folder should not fail the whole listing.
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (skippedDirectories.has(entry.name.toLowerCase())) continue;
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(project.root!, absolute).replaceAll('\\', '/');
      if (entry.isDirectory()) {
        output.push({ path: relative, type: 'directory' });
        await walk(absolute, depth + 1);
      } else if (isReadableName(entry.name) && !isProtectedSegment(entry.name)) {
        output.push({ path: relative, type: 'file' });
      }
      if (output.length >= 400) break;
    }
  }
  await walk(project.root, 0);
  return output;
}

export async function readProjectFile(project: ProjectConfig, relativePath: string) {
  const safe = await safeProjectPath(project, relativePath);
  const stat = await fs.stat(safe.target).catch(() => null);
  if (!stat?.isFile()) throw new PublicError('That file does not exist.', 404);
  if (stat.size > maxFileBytes) throw new PublicError('The requested file is too large to open in Command Deck.');
  const content = await fs.readFile(safe.target, 'utf8');
  return { path: safe.relative, content, hash: hash(content), size: stat.size };
}

export async function applyProjectFile(project: ProjectConfig, relativePath: string, content: string, expectedHash: string) {
  if (Buffer.byteLength(content, 'utf8') > maxFileBytes) throw new PublicError('The proposed content is too large.');
  const safe = await safeProjectPath(project, relativePath, { forWrite: true });
  const current = await fs.readFile(safe.target, 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  if (hash(current) !== expectedHash) throw new PublicError('The file changed after this changeset was created. Refresh and review again.', 409);
  await fs.mkdir(path.dirname(safe.target), { recursive: true });
  const temporary = safe.target + '.command-deck-' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temporary, content, 'utf8');
  await fs.rename(temporary, safe.target);
  invalidateProjectCache();
  return hash(content);
}

export function hash(content: string) {
  return crypto.createHash('sha256').update(content).digest('hex');
}
