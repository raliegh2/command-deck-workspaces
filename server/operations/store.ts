import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { SafeOperationsSnapshot } from '../types.js';

// Resolved lazily so tests (and COMMAND_DECK_DATA_DIR) can redirect storage after import.
function snapshotRoot() {
  if (process.env.COMMAND_DECK_DATA_DIR) return path.resolve(process.env.COMMAND_DECK_DATA_DIR);
  return process.env.VERCEL ? path.join('/tmp', 'command-deck') : path.resolve('data');
}
const snapshotPath = () => path.join(snapshotRoot(), 'operations-state.json');
const incidentsPath = () => path.join(snapshotRoot(), 'operations-incidents.json');

function emptySnapshot(): SafeOperationsSnapshot {
  return { schemaVersion: '1.0', lastRun: null, sites: [] };
}

async function writeJsonAtomic(file: string, value: unknown) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = file + '.' + crypto.randomUUID() + '.tmp';
  await fs.writeFile(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await fs.rename(temporary, file);
}

export async function readOperationsSnapshot(): Promise<SafeOperationsSnapshot> {
  try {
    const value = JSON.parse(await fs.readFile(snapshotPath(), 'utf8')) as SafeOperationsSnapshot;
    return value.schemaVersion === '1.0' && Array.isArray(value.sites) ? value : emptySnapshot();
  } catch {
    return emptySnapshot();
  }
}

function opsStoreConfig() {
  const url = process.env.OPS_SUPABASE_URL;
  const key = process.env.OPS_SUPABASE_SECRET_KEY;
  return url && key ? { url: url.replace(/\/$/, ''), key } : null;
}

function storeHeaders(key: string) {
  return {
    apikey: key,
    Authorization: 'Bearer ' + key,
    'Content-Type': 'application/json',
  };
}

/** PostgREST reports failures as HTTP status codes, which fetch does not throw on. */
async function storeRequest(pathAndQuery: string, init: RequestInit & { headers: Record<string, string> }) {
  const config = opsStoreConfig();
  if (!config) return null;
  const response = await fetch(config.url + '/rest/v1/' + pathAndQuery, {
    ...init,
    headers: { ...storeHeaders(config.key), ...init.headers },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    console.error(JSON.stringify({ level: 'warn', event: 'ops_store_request_failed', status: response.status }));
    throw new Error('Operations store request failed.');
  }
  return response;
}

export async function enqueueRemoteCommand(input: { systemId: string; role: string; prompt: string }) {
  if (!opsStoreConfig()) return null;
  const requestId = 'cmd_' + crypto.randomUUID();
  try {
    await storeRequest('ops_command_requests', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ request_id: requestId, system_id: input.systemId, agent_role: input.role, prompt_redacted: input.prompt, status: 'queued', source: 'discord' }),
    });
    return requestId;
  } catch {
    return null;
  }
}

export async function readFailureStreaks(siteIds: string[]) {
  const fallback = await readOperationsSnapshot();
  const streaks = Object.fromEntries(siteIds.map((id) => [
    id,
    fallback.sites.find((site) => site.id === id)?.failureStreak ?? 0,
  ]));
  if (!opsStoreConfig()) return streaks;

  try {
    const query = new URLSearchParams({
      select: 'site_id,live_status,checked_at',
      site_id: `in.(${siteIds.join(',')})`,
      order: 'checked_at.desc',
      limit: String(20 * siteIds.length),
    });
    const response = await storeRequest('ops_monitor_runs?' + query, { headers: {} });
    const rows = await response!.json() as Array<{ site_id?: string; live_status?: string }>;
    const complete = new Set<string>();
    for (const id of siteIds) streaks[id] = 0;
    for (const row of rows) {
      const id = row.site_id ?? '';
      if (!siteIds.includes(id) || complete.has(id)) continue;
      if (row.live_status === 'offline') streaks[id] += 1;
      else complete.add(id);
    }
  } catch {
    // The monitor can still run without its optional remote metadata store.
  }
  return streaks;
}

/**
 * Saves the snapshot locally, and to the remote store only for scheduled runs: manual
 * "Run checks now" results must not count toward the scheduled failure streak.
 */
export async function saveOperationsSnapshot(snapshot: SafeOperationsSnapshot, options: { recordRemote?: boolean } = {}) {
  await writeJsonAtomic(snapshotPath(), snapshot);
  if (!options.recordRemote || !opsStoreConfig()) return;
  const rows = snapshot.sites.map((site) => ({
    site_id: site.id,
    checked_at: site.checkedAt,
    live_status: site.live,
    http_status: site.statusCode,
    provider_error_count: site.providerErrors,
    supabase_warning_count: site.supabaseSecurity?.warnings ?? null,
    supabase_error_count: site.supabaseSecurity?.errors ?? null,
    failure_streak: site.failureStreak,
  }));
  try {
    await storeRequest('ops_monitor_runs', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows) });
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    await storeRequest('ops_monitor_runs?' + new URLSearchParams({ checked_at: 'lt.' + cutoff }), { method: 'DELETE', headers: {} });
  } catch {
    // Local metadata remains available if the optional remote store is unavailable.
  }
}

export interface OpenIncident {
  key: string;
  incidentId: string;
  siteId: string;
  severity: 'outage' | 'critical';
  code: string;
  openedAt: string;
}

async function readLocalIncidents(): Promise<OpenIncident[]> {
  try {
    const value = JSON.parse(await fs.readFile(incidentsPath(), 'utf8')) as unknown;
    return Array.isArray(value) ? value as OpenIncident[] : [];
  } catch {
    return [];
  }
}

/** Open incidents, from the remote store when configured (it survives stateless cron runs), else locally. */
export async function openIncidents(): Promise<Map<string, OpenIncident>> {
  if (opsStoreConfig()) {
    try {
      const query = new URLSearchParams({ select: 'incident_id,site_id,severity,signal_code,opened_at', state: 'eq.open' });
      const response = await storeRequest('ops_incidents?' + query, { headers: {} });
      const rows = await response!.json() as Array<{ incident_id: string; site_id: string; severity: 'outage' | 'critical'; signal_code: string; opened_at: string }>;
      return new Map(rows.map((row) => {
        const key = row.site_id + ':' + row.signal_code;
        return [key, { key, incidentId: row.incident_id, siteId: row.site_id, severity: row.severity, code: row.signal_code, openedAt: row.opened_at }];
      }));
    } catch {
      // Fall back to local state.
    }
  }
  return new Map((await readLocalIncidents()).map((incident) => [incident.key, incident]));
}

export async function recordOpenIncidents(incidents: OpenIncident[]) {
  const local = await readLocalIncidents();
  await writeJsonAtomic(incidentsPath(), [...local.filter((item) => !incidents.some((next) => next.key === item.key)), ...incidents]);
  if (!opsStoreConfig()) return;
  const now = new Date().toISOString();
  try {
    await storeRequest('ops_incidents', {
      method: 'POST',
      headers: { Prefer: 'return=minimal,resolution=merge-duplicates' },
      body: JSON.stringify(incidents.map((incident) => ({
        incident_id: incident.incidentId, site_id: incident.siteId, severity: incident.severity,
        signal_code: incident.code, state: 'open', opened_at: incident.openedAt, updated_at: now,
      }))),
    });
    await storeRequest('ops_notifications', {
      method: 'POST',
      headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
      body: JSON.stringify(incidents.map((incident) => ({ idempotency_key: 'open:' + incident.incidentId, incident_id: incident.incidentId, state: 'sent', sent_at: now }))),
    });
  } catch {
    // The local record still suppresses duplicates on this machine.
  }
}

export async function closeIncidents(incidents: OpenIncident[]) {
  const keys = new Set(incidents.map((incident) => incident.key));
  const local = await readLocalIncidents();
  if (local.some((item) => keys.has(item.key))) await writeJsonAtomic(incidentsPath(), local.filter((item) => !keys.has(item.key)));
  if (!opsStoreConfig()) return;
  try {
    const query = new URLSearchParams({ incident_id: `in.(${incidents.map((incident) => incident.incidentId).join(',')})` });
    await storeRequest('ops_incidents?' + query, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ state: 'recovered', updated_at: new Date().toISOString() }),
    });
  } catch {
    // Retried on the next run because the incident is still listed as open.
  }
}
