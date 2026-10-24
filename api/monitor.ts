import crypto from 'node:crypto';
import { runMonitoringCycle } from '../server/operations/monitor.js';

function authorized(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const presented = Buffer.from(request.headers.get('authorization') ?? '');
  const wanted = Buffer.from(`Bearer ${expected}`);
  return presented.length === wanted.length && crypto.timingSafeEqual(presented, wanted);
}

// Vercel's Node runtime passes a Web Request only to named HTTP-method exports; cron uses GET.
export async function GET(request: Request): Promise<Response> {
  if (!authorized(request)) return new Response('Unauthorized', { status: 401 });

  try {
    const snapshot = await runMonitoringCycle({ sendAlerts: true, scheduled: true });
    return Response.json({
      ok: true,
      lastRun: snapshot.lastRun,
      systems: snapshot.sites.length,
      online: snapshot.sites.filter((site) => site.live === 'online').length,
      offline: snapshot.sites.filter((site) => site.live === 'offline').length,
    });
  } catch {
    return Response.json({ ok: false, error: 'monitor-cycle-failed' }, { status: 500 });
  }
}
