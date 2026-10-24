import { loadOperations, loadProductionApps } from '../config.js';
import type { OperationsAppConfig, SafeOperationsSnapshot } from '../types.js';
import { isTrustedDiscordWebhook, sendUrgentAlerts } from './alerts.js';
import { checkReachability } from './providers/http.js';
import { readRenderErrorSummary } from './providers/render.js';
import { readSupabaseSecuritySummary } from './providers/supabase.js';
import { readVercelErrorSummary } from './providers/vercel.js';
import { readFailureStreaks, saveOperationsSnapshot } from './store.js';

type ProviderSummary = { count: number; classes: Record<string, number> } | null;

async function providerSummary(app: OperationsAppConfig): Promise<ProviderSummary> {
  if (app.provider.kind === 'render') return readRenderErrorSummary(app);
  if (app.provider.kind === 'vercel') return readVercelErrorSummary(app);
  return null;
}

async function safely<T>(operation: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await operation();
  } catch {
    return fallback;
  }
}

let activeCycle: Promise<SafeOperationsSnapshot> | null = null;

/**
 * `scheduled` runs (the cron) advance failure streaks and write to the remote store. Manual runs
 * report current reachability but leave the streak untouched, so clicking "Run checks now"
 * repeatedly cannot manufacture an outage alert.
 */
export async function runMonitoringCycle(options: { sendAlerts?: boolean; scheduled?: boolean } = {}) {
  if (activeCycle) return activeCycle;
  const scheduled = options.scheduled ?? options.sendAlerts ?? false;
  activeCycle = (async () => {
    const [production, operations] = await Promise.all([loadProductionApps(), loadOperations()]);
    const productionById = new Map(production.map((app) => [app.id, app]));
    const previousStreaks = await readFailureStreaks(operations.apps.map((app) => app.id));

    const sites = await Promise.all(operations.apps.map(async (app) => {
      const productionApp = productionById.get(app.id);
      const [reachability, provider, supabase] = await Promise.all([
        productionApp
          // Manual runs answer quickly; scheduled runs confirm an outage with retries.
          ? checkReachability(productionApp.liveUrl, { attempts: scheduled ? 3 : 1 })
          : Promise.resolve({ live: 'unknown' as const, statusCode: null, checkedAt: new Date().toISOString(), failedAttempts: 0 }),
        safely(() => providerSummary(app), null),
        safely(() => readSupabaseSecuritySummary(app), null),
      ]);
      const previous = previousStreaks[app.id] ?? 0;
      const failureStreak = reachability.live === 'online'
        ? 0
        : reachability.live === 'offline' && scheduled
          ? previous + 1
          : previous;
      return {
        id: app.id,
        live: reachability.live,
        statusCode: reachability.statusCode,
        providerErrors: provider?.count ?? null,
        providerErrorClasses: provider?.classes ?? {},
        supabaseSecurity: supabase,
        failureStreak,
        failedAttempts: reachability.failedAttempts,
        checkedAt: reachability.checkedAt,
      };
    }));

    const snapshot: SafeOperationsSnapshot = {
      schemaVersion: '1.0',
      lastRun: new Date().toISOString(),
      sites,
    };
    await saveOperationsSnapshot(snapshot, { recordRemote: scheduled });
    if (options.sendAlerts) {
      await sendUrgentAlerts(snapshot).catch(() => ({ configured: isTrustedDiscordWebhook(process.env.DISCORD_WEBHOOK_URL), sent: 0 }));
    }
    return snapshot;
  })();

  try {
    return await activeCycle;
  } finally {
    activeCycle = null;
  }
}
