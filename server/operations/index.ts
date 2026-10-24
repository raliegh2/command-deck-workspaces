import { loadOperations } from '../config.js';
import type { ConnectorStatus, OperationsAppConfig } from '../types.js';
import { isTrustedDiscordWebhook } from './alerts.js';
import { runMonitoringCycle } from './monitor.js';
import { readOperationsSnapshot } from './store.js';

function readiness(required: string[], used = true): { status: ConnectorStatus; missing: string[] } {
  if (!used) return { status: 'not-used', missing: [] };
  const missing = required.filter((name) => !process.env[name]);
  return { status: missing.length ? 'needs-configuration' : 'connected', missing };
}

function providerConfigured(app: OperationsAppConfig) {
  if (app.provider.kind === 'cloudflare-workers') return false; // Metadata-only reachability; provider log ingestion is not implemented.
  if (app.provider.kind === 'github-pages') return true;
  if (app.provider.kind === 'render') {
    return Boolean(
      process.env.RENDER_API_KEY &&
      (app.provider.ownerId || process.env.RENDER_OWNER_ID) &&
      (app.provider.serviceId || process.env.RENDER_LESSONPLANTOGO_SERVICE_ID),
    );
  }
  return Boolean(
    process.env.VERCEL_TOKEN &&
    (app.provider.projectId || process.env.VERCEL_CHURCH_CARE_PROJECT_ID) &&
    (app.provider.teamId || process.env.VERCEL_TEAM_ID),
  );
}

export async function getOperationsView() {
  const [config, snapshot] = await Promise.all([loadOperations(), readOperationsSnapshot()]);
  const snapshotById = new Map(snapshot.sites.map((site) => [site.id, site]));
  const connectors = {
    render: readiness(['RENDER_API_KEY', 'RENDER_OWNER_ID', 'RENDER_LESSONPLANTOGO_SERVICE_ID'],config.apps.some(a=>a.provider.kind==='render')),
    vercel: readiness(['VERCEL_TOKEN'],config.apps.some(a=>a.provider.kind==='vercel')),
    supabase: readiness(['SUPABASE_ACCESS_TOKEN'],config.apps.some(a=>a.supabase.status!=='not-used')),
    cloudflare: {status:config.apps.some(a=>a.provider.kind==='cloudflare-workers')?'needs-configuration' as const:'not-used' as const,missing:['provider-log-ingestion-connector']},
    discord: isTrustedDiscordWebhook(process.env.DISCORD_WEBHOOK_URL)
      ? { status: 'connected' as const, missing: [] }
      : { status: 'needs-configuration' as const, missing: ['DISCORD_WEBHOOK_URL'] },
  };

  return {
    schemaVersion: config.schemaVersion,
    totals: {
      agents: config.agentRoles.length * config.apps.length,
      systems: config.apps.length,
      automaticRoles: config.agentRoles.filter((role) => role.mode === 'automatic').length * config.apps.length,
    },
    privacy: config.privacy,
    automation: { ...config.automation, configured: process.env.COMMAND_DECK_WORKER_DEPLOYED === 'true', lastRun: snapshot.lastRun },
    alerting: { provider: config.alerting.provider, policy: config.alerting.policy, configured: connectors.discord.status === 'connected' },
    connectors,
    roles: config.agentRoles,
    sites: config.apps.map((app) => {
      const monitor = snapshotById.get(app.id);
      return {
        id: app.id,
        provider: { kind: app.provider.kind, name: app.provider.name, verified: app.provider.verified, connectorConfigured: providerConfigured(app) },
        agents: { count: config.agentRoles.length, roles: config.agentRoles },
        staging: app.staging,
        supabase: {
          status: app.supabase.status,
          projectName: app.supabase.projectName,
          branchStatus: app.supabase.branchStatus,
          advisorStatus: app.supabase.advisorStatus,
          securityWarnings: app.supabase.securityWarnings,
          securityInfo: app.supabase.securityInfo,
          workerConfigured: app.supabase.status === 'not-used' || Boolean(process.env.SUPABASE_ACCESS_TOKEN),
        },
        monitor: monitor ? {
          live: monitor.live, statusCode: monitor.statusCode, providerErrors: app.provider.kind==='cloudflare-workers'?null:monitor.providerErrors,
          providerErrorClasses: app.provider.kind==='cloudflare-workers'?{}:monitor.providerErrorClasses, failureStreak: monitor.failureStreak, checkedAt: monitor.checkedAt,
        } : { live: 'unknown' as const, statusCode: null, providerErrors: null, providerErrorClasses: {}, failureStreak: 0, checkedAt: null },
      };
    }),
  };
}

export async function runAndGetOperationsView() {
  await runMonitoringCycle({ sendAlerts: false });
  return getOperationsView();
}
