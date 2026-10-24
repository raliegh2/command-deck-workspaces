import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { PublicError } from './errors.js';
import type { AgentTeam, OperationsConfig, ProductionAppConfig, ProjectConfig } from './types.js';

const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(100),
  kind: z.enum(['security', 'builder', 'integration', 'knowledge', 'other']),
  root: z.string().nullable(),
  knowledgePath: z.string().nullable().optional(),
  remoteUrl: z.string().url().nullable().optional(),
  description: z.string().min(2).max(500),
  teamId: z.string().min(2).max(100),
  healthUrl: z.string().url().nullable().optional(),
  allowedScripts: z.array(z.string().regex(/^[a-z0-9:_-]{1,40}$/)).max(12),
});

const configDir = process.env.COMMAND_DECK_CONFIG_DIR ? path.resolve(process.env.COMMAND_DECK_CONFIG_DIR) : path.resolve('config');
const configPath = path.join(configDir, 'projects.json');
const teamsPath = path.join(configDir, 'teams.json');
const productionPath = path.join(configDir, 'production.json');
const operationsPath = path.join(configDir, 'operations.json');
const teamSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(100),
  description: z.string().min(2).max(300),
  color: z.enum(['green', 'blue', 'neutral']),
  roles: z.array(z.string().min(2).max(100)).min(1).max(12),
});

const productionSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  projectId: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(2).max(100),
  description: z.string().min(2).max(500),
  root: z.string().min(3),
  repositoryUrl: z.string().url(),
  repositoryConnection: z.enum(['github-connected', 'private-unverified']),
  liveUrl: z.string().url().refine((value) => value.startsWith('https://'), 'Production URLs must use HTTPS.'),
  previewMode: z.enum(['iframe', 'external-only']),
  teamId: z.string().min(2).max(100),
});

const operationsSchema = z.object({
  schemaVersion: z.literal('1.0'),
  privacy: z.object({
    mode: z.literal('metadata-only'),
    rawLogRetentionMinutes: z.literal(0),
    customerDataAccess: z.literal('denied'),
    stagingData: z.literal('synthetic-only'),
    messageContent: z.literal('redacted-operational-summary'),
  }),
  automation: z.object({
    provider: z.literal('vercel-cron'),
    schedule: z.string().min(5).max(100),
    blueprintPath: z.string().min(3).max(200),
    deploymentStatus: z.enum(['blueprint-ready', 'deployed']),
  }),
  alerting: z.object({
    provider: z.literal('discord'),
    policy: z.literal('urgent-only'),
    severities: z.array(z.enum(['outage', 'critical'])),
    status: z.enum(['needs-configuration', 'configured']),
  }),
  agentRoles: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(2).max(100),
    responsibility: z.string().min(5).max(300),
    mode: z.enum(['automatic', 'observe', 'staging', 'gate-only']),
  })).length(9),
  apps: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    provider: z.object({
      kind: z.enum(['render', 'vercel', 'github-pages', 'cloudflare-workers']),
      name: z.string().min(2).max(100),
      verified: z.boolean(),
      serviceId: z.string().nullable().optional(),
      ownerId: z.string().nullable().optional(),
      projectId: z.string().nullable().optional(),
      teamId: z.string().nullable().optional(),
    }),
    staging: z.object({
      strategy: z.string().min(3).max(100),
      status: z.enum(['ready', 'partial', 'not-configured']),
      url: z.string().url().nullable(),
      productionDataAllowed: z.literal(false),
      detail: z.string().min(5).max(500),
    }),
    supabase: z.object({
      status: z.enum(['verified', 'not-used']),
      projectRef: z.string().nullable(),
      projectName: z.string().nullable(),
      branchStatus: z.enum(['not-configured', 'ready', 'not-applicable']),
      advisorStatus: z.enum(['ready', 'action-needed', 'unavailable', 'not-applicable']),
      securityWarnings: z.number().int().min(0),
      securityInfo: z.number().int().min(0),
      observedAt: z.string().datetime().nullable(),
    }),
  })).min(0),
});

/**
 * Config files are re-read only when their size or modification time changes, so request
 * handlers can call the loaders freely without re-parsing and re-validating JSON each time.
 */
const configCache = new Map<string, { stamp: string; value: unknown }>();

async function loadConfig<T>(file: string, schema: z.ZodType<T, unknown>): Promise<T> {
  const stat = await fs.stat(file);
  const stamp = stat.size + ':' + stat.mtimeMs;
  const cached = configCache.get(file);
  if (cached?.stamp === stamp) return structuredClone(cached.value as T);
  const value = schema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
  configCache.set(file, { stamp, value });
  return structuredClone(value);
}

export async function loadProjects(): Promise<ProjectConfig[]> {
  return loadConfig(configPath, z.array(projectSchema)) as Promise<ProjectConfig[]>;
}

export async function loadTeams(): Promise<AgentTeam[]> {
  return loadConfig(teamsPath, z.array(teamSchema)) as Promise<AgentTeam[]>;
}

export async function loadProductionApps(): Promise<ProductionAppConfig[]> {
  return loadConfig(productionPath, z.array(productionSchema)) as Promise<ProductionAppConfig[]>;
}

export async function loadOperations(): Promise<OperationsConfig> {
  return loadConfig(operationsPath, operationsSchema) as Promise<OperationsConfig>;
}

/** Folders a project may live under (semicolon-separated). Defaults to the user's home directory. */
function workspaceRoots() {
  const configured = (process.env.COMMAND_DECK_WORKSPACE_ROOTS ?? '').split(';').map((item) => item.trim()).filter(Boolean);
  return (configured.length ? configured : [os.homedir()]).map((item) => path.resolve(item));
}

/** Folder names that hold credentials, OS state, or auto-run locations and must never become a project. */
const deniedSegments = new Set(['appdata', '.ssh', '.aws', '.azure', '.gnupg', '.docker', '.kube', '.config', 'windows', 'program files', 'program files (x86)', 'programdata', 'start menu', 'startup']);

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export async function addProject(project: ProjectConfig): Promise<ProjectConfig> {
  const parsed = projectSchema.parse(project) as ProjectConfig;
  if (!parsed.root || !path.isAbsolute(parsed.root)) throw new PublicError('An absolute local project path is required.');
  const stat = await fs.stat(parsed.root).catch(() => null);
  if (!stat?.isDirectory()) throw new PublicError('The project path does not exist or is not a directory.');
  // Resolve junctions, symlinks and 8.3 short names before deciding whether the folder is allowed.
  const canonicalRoot = await fs.realpath(parsed.root);
  const approvedRoots=await Promise.all(workspaceRoots().map(root=>fs.realpath(root).catch(()=>null)));
  if (!approvedRoots.some((root) => root!==null&&isInside(root, canonicalRoot))) {
    throw new PublicError('Projects must live inside an approved workspace folder (set COMMAND_DECK_WORKSPACE_ROOTS to change this).');
  }
  if (canonicalRoot.split(/[\\/]/).some((segment) => deniedSegments.has(segment.toLowerCase()))) {
    throw new PublicError('That folder holds system or credential data and cannot be registered.');
  }
  const projects = await loadProjects();
  if (projects.some((item) => item.id === parsed.id)) throw new PublicError('A project with that ID already exists.');
  projects.push({ ...parsed, root: canonicalRoot });
  await fs.writeFile(configPath, JSON.stringify(projects, null, 2) + '\n', 'utf8');
  return { ...parsed, root: canonicalRoot };
}
