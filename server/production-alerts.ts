import {loadProductionApps} from './config.js';
import { execFile } from 'node:child_process';
import type { ProductionAlerts, ProductionAlertSite, ProductionIncident } from '../shared/production-alerts.js';

const incidentTitle = '[Production incident] Availability or application assets';
type Run = { id: number; status: string; conclusion: string | null; updated_at: string };
type Issue = { number: number; title: string; state: string; created_at: string; closed_at: string | null; user?: { login: string }; pull_request?: unknown };

function githubApi(endpoint: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    execFile('gh', ['api', endpoint], { windowsHide: true, timeout: 20_000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: '1' } }, (error, stdout) => {
      if (error) return reject(new Error('GitHub monitoring data unavailable. Check local gh authentication.'));
      try { resolve(JSON.parse(stdout)); } catch { reject(new Error('Unreadable GitHub monitoring response.')); }
    });
  });
}

export function monitoringStatus(input: Pick<ProductionAlertSite, 'connected' | 'monitoringEnabled' | 'lastCheck' | 'incidents'>, now = Date.now()): ProductionAlertSite['status'] {
  if (!input.connected) return 'unknown';
  if (input.incidents.some(issue => issue.state === 'open')) return 'incident';
  if (!input.monitoringEnabled || !input.lastCheck) return 'unknown';
  const time = Date.parse(input.lastCheck.at);
  if (!Number.isFinite(time) || now - time > 45 * 60_000 || time > now + 60_000) return 'stale';
  return input.lastCheck.conclusion === 'success' ? 'passing' : 'check-failed';
}

export function productionIncidents(issues: Issue[], repository: string): ProductionIncident[] {
  return issues.filter(issue => issue.user?.login === 'github-actions[bot]' && !issue.pull_request && issue.title === incidentTitle && Number.isSafeInteger(issue.number))
    .map(issue => ({ number: issue.number, state: issue.state === 'open' ? 'open' as const : 'closed' as const, openedAt: issue.created_at, closedAt: issue.closed_at, url: `https://github.com/${repository}/issues/${issue.number}` }));
}

let cached: ProductionAlerts | undefined;
let active: Promise<ProductionAlerts> | undefined;
/** Fixed repositories; read-only CLI calls. No tokens or raw logs are returned to the browser. */
export async function getProductionAlerts(): Promise<ProductionAlerts> {
  if (cached && Date.now() - Date.parse(cached.fetchedAt) < 30_000) return cached;
  if (active) return active;
  active = (async () => {
    const targets=(await loadProductionApps()).filter(p=>p.repositoryUrl.startsWith('https://github.com/')).map(p=>({id:p.id,name:p.name,liveUrl:p.liveUrl,repository:new URL(p.repositoryUrl).pathname.slice(1).replace(/\.git$/,'')}));
    const sites = await Promise.all(targets.map(async target => {
      const base = `repos/${target.repository}`;
      const workflowUrl = `https://github.com/${target.repository}/actions/workflows/production-watch.yml`;
      try {
        const [workflow, runData, issueData] = await Promise.all([
          githubApi(`${base}/actions/workflows/production-watch.yml`) as Promise<{ state: string }>,
          githubApi(`${base}/actions/workflows/production-watch.yml/runs?per_page=20`) as Promise<{ workflow_runs: Run[] }>,
          githubApi(`${base}/issues?state=all&creator=github-actions%5Bbot%5D&sort=updated&per_page=100`) as Promise<Issue[]>,
        ]);
        if (!Array.isArray(runData.workflow_runs) || !Array.isArray(issueData)) throw new Error('Invalid response');
        const run = runData.workflow_runs.find(item => item.status === 'completed' && item.conclusion !== 'cancelled' && item.conclusion !== 'skipped' && Number.isSafeInteger(item.id));
        const site = { ...target, workflowUrl, connected: true, monitoringEnabled: workflow.state === 'active', lastCheck: run ? { at: run.updated_at, conclusion: run.conclusion ?? 'unknown', url: `https://github.com/${target.repository}/actions/runs/${run.id}` } : null, incidents: productionIncidents(issueData, target.repository) };
        return { ...site, status: monitoringStatus(site) };
      } catch {
        const previous = cached?.sites.find(site => site.id === target.id);
        return { ...target, workflowUrl, connected: false, monitoringEnabled: previous?.monitoringEnabled ?? null, lastCheck: previous?.lastCheck ?? null, incidents: previous?.incidents ?? [], status: 'unknown' as const };
      }
    }));
    return cached = { fetchedAt: new Date().toISOString(), sites };
  })();
  try { return await active; } finally { active = undefined; }
}
