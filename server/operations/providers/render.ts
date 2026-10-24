import type { OperationsAppConfig } from '../../types.js';
import { summarizeProviderEvents } from '../privacy.js';

export async function readRenderErrorSummary(app: OperationsAppConfig) {
  const token = process.env.RENDER_API_KEY;
  const ownerId = app.provider.ownerId ?? process.env.RENDER_OWNER_ID;
  const serviceId = app.provider.serviceId ?? process.env.RENDER_LESSONPLANTOGO_SERVICE_ID;
  if (!token || !ownerId || !serviceId) return null;

  const query = new URLSearchParams({
    ownerId,
    startTime: new Date(Date.now() - 10 * 60_000).toISOString(),
    endTime: new Date().toISOString(),
    direction: 'backward',
    limit: '100',
  });
  query.append('resource', serviceId);
  query.append('level', 'error');
  const response = await fetch('https://api.render.com/v1/logs?' + query, {
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error('Render metadata request failed.');
  const payload = await response.json() as unknown;
  const root = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
  const events = Array.isArray(payload) ? payload : Array.isArray(root.logs) ? root.logs : Array.isArray(root.items) ? root.items : [];
  return summarizeProviderEvents(events);
}
