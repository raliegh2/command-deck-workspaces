import {PublicError} from './errors.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { redactSensitiveText, safePrompt } from './privacy.js';
import type { Activity, ChangeSet, RuntimeState, WorkItem } from './types.js';

export const dataDir = process.env.COMMAND_DECK_DATA_DIR
  ? path.resolve(process.env.COMMAND_DECK_DATA_DIR)
  : process.env.VERCEL ? path.join('/tmp', 'command-deck') : path.resolve('data');
const statePath = path.join(dataDir, 'runtime.json');
const outboxPath = path.join(dataDir, 'outbox.jsonl');
/** Resolved changesets carry full file contents, so only the most recent are kept. Pending ones are never dropped. */
const maxResolvedChangesets = 50;
let state: RuntimeState = { work: [], activity: [], changesets: [] };

const legacyHarnessSummary = 'DeepSeek, Codex, and Claude are available as complementary advisory harnesses';
const localHarnessSummary = 'Local DeepSeek is the only enabled advisory harness';

function paidHarnessesEnabled() {
  return process.env.COMMAND_DECK_ENABLE_PAID_HARNESSES === '1';
}

/** Redact string values before serialization; redacting serialized JSON can corrupt numbers. */
function connectorJson(message:unknown){
  return JSON.stringify(message,(key,value:unknown)=>{
    if(typeof value!=='string')return value;
    if(['id','workItemId'].includes(key)&&/^(?:work_|change_)?[a-f0-9-]{36}$/i.test(value))return value;
    if(/^(?:api[_-]?key|token|secret|password|authorization|cookie|session)$/i.test(key))return '[redacted-secret]';
    return redactSensitiveText(value);
  });
}

export function enforceHarnessPolicyOnOutbox(contents: string) {
  if (paidHarnessesEnabled()) return contents;
  const trailingNewline = contents.endsWith('\n');
  const lines = contents.split(/\r?\n/).filter((line) => line.length > 0).map((line) => {
    try {
      const message = JSON.parse(line) as { body?: { advisoryHarnesses?: unknown; coordinationMode?: unknown } };
      if (message.body && Array.isArray(message.body.advisoryHarnesses)) {
        message.body.advisoryHarnesses = ['deepseek'];
        message.body.coordinationMode = 'local-deepseek-only';
      }
      return JSON.stringify(message);
    } catch {
      return line;
    }
  });
  return lines.join('\n') + (trailingNewline && lines.length > 0 ? '\n' : '');
}

export async function initStore() {
  await fs.mkdir(dataDir, { recursive: true });
  let raw: string | null = null;
  try {
    raw = await fs.readFile(statePath, 'utf8');
  } catch {
    // First run: no state yet.
  }
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<RuntimeState>;
      state = {
        work: (parsed.work ?? []).map((item) => ({
          ...item,
          prompt: safePrompt(item.prompt),
          title: safePrompt(item.title),
          summary: paidHarnessesEnabled() ? item.summary : item.summary.replace(legacyHarnessSummary, localHarnessSummary),
        })),
        activity: parsed.activity ?? [],
        changesets: parsed.changesets ?? [],
      };
      await persist();
    } catch {
      // Keep the unreadable file for recovery instead of silently overwriting it.
      await fs.rename(statePath, statePath.replace(/\.json$/, `.corrupt-${Date.now()}.json`)).catch(() => undefined);
      state = { work: [], activity: [], changesets: [] };
    }
  }
  try {
    const existing = await fs.readFile(outboxPath, 'utf8');
    const sanitized = enforceHarnessPolicyOnOutbox(existing.split(/\r?\n/).map(line=>{if(!line)return '';try{return connectorJson(JSON.parse(line));}catch{return redactSensitiveText(line);}}).join('\n'));
    if (sanitized !== existing) await fs.writeFile(outboxPath, sanitized, 'utf8');
  } catch {
    // The connector outbox is created on first dispatch.
  }
}

let writing: Promise<void> | null = null;
let pendingWrite = false;

/**
 * Writes are serialized and coalesced: concurrent callers share one follow-up write instead of
 * racing on the same temporary file (which fails with EPERM on Windows).
 */
function persist(): Promise<void> {
  if (writing) {
    pendingWrite = true;
    return writing;
  }
  writing = (async () => {
    try {
      do {
        pendingWrite = false;
        const temporary = statePath + '.tmp';
        await fs.writeFile(temporary, JSON.stringify(state), 'utf8');
        await fs.rename(temporary, statePath);
      } while (pendingWrite);
    } finally {
      writing = null;
    }
  })();
  return writing;
}

export function getState() {
  return structuredClone(state);
}

export async function addWork(item: WorkItem) {
  state.work.unshift(item);
  state.work = state.work.slice(0, 100);
  await persist();
}

export async function addActivity(item: Activity) {
  state.activity.unshift(item);
  state.activity = state.activity.slice(0, 100);
  await persist();
}

function trimChangesets() {
  let resolved = 0;
  state.changesets = state.changesets.filter((item) => item.status === 'pending' || ++resolved <= maxResolvedChangesets);
}

export async function addChangeset(item: ChangeSet) {
  state.changesets.unshift(item);
  trimChangesets();
  await persist();
}

export function findChangeset(id: string) {
  const item = state.changesets.find((entry) => entry.id === id);
  return item ? structuredClone(item) : null;
}

export async function updateChangeset(id: string, update: Partial<ChangeSet>) {
  const item = state.changesets.find((entry) => entry.id === id);
  if (!item) return null;
  Object.assign(item, update);
  trimChangesets();
  await persist();
  return structuredClone(item);
}

export async function enqueueConnectorMessage(message: unknown) {
  await fs.appendFile(outboxPath, connectorJson(message) + '\n', 'utf8');
}

export async function setWorkStatus(id:string,status:WorkItem['status']){const item=state.work.find(w=>w.id===id);if(!item)throw new PublicError('Task not found.',404);item.status=status;await persist();return structuredClone(item);}
