import type { OperationsAppConfig } from '../../types.js';
import { summarizeProviderEvents } from '../privacy.js';

async function boundedDeploymentEvents(deploymentId: string, teamId: string, token: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  const events: unknown[] = [];
  try {
    const response = await fetch(
      `https://api.vercel.com/v3/deployments/${encodeURIComponent(deploymentId)}/events?teamId=${encodeURIComponent(teamId)}`,
      { headers: { Authorization: 'Bearer ' + token }, signal: controller.signal },
    );
    if (!response.ok || !response.body) throw new Error('Vercel metadata request failed.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let bytes = 0;
    while (events.length < 100 && bytes < 256_000) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try { events.push(JSON.parse(line)); } catch { /* Ignore malformed provider lines. */ }
        if (events.length >= 100) break;
      }
    }
    await reader.cancel();
  } finally {
    clearTimeout(timeout);
  }
  return summarizeProviderEvents(events);
}

export async function readVercelErrorSummary(app: OperationsAppConfig) {
  const token = process.env.VERCEL_TOKEN;
  const projectId = app.provider.projectId ?? process.env.VERCEL_CHURCH_CARE_PROJECT_ID;
  const teamId = app.provider.teamId ?? process.env.VERCEL_TEAM_ID;
  if (!token || !projectId || !teamId) return null;

  const query = new URLSearchParams({ projectId, teamId, target: 'production', limit: '1' });
  const response = await fetch('https://api.vercel.com/v6/deployments?' + query, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error('Vercel deployment metadata request failed.');
  const payload = await response.json() as Record<string, unknown>;
  const deployments = Array.isArray(payload.deployments) ? payload.deployments : [];
  const latest = deployments[0] as Record<string, unknown> | undefined;
  const deploymentId = typeof latest?.uid === 'string'
    ? latest.uid
    : typeof latest?.id === 'string'
      ? latest.id
      : null;
  if (!deploymentId) return { count: 0, classes: {} };
  return boundedDeploymentEvents(deploymentId, teamId, token);
}
