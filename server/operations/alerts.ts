import crypto from 'node:crypto';
import type { SafeOperationsSnapshot } from '../types.js';
import { closeIncidents, openIncidents, recordOpenIncidents, type OpenIncident } from './store.js';

export interface UrgentSignal {
  siteId: string;
  severity: 'outage' | 'critical';
  code: 'availability.failed-three-times' | 'security-advisor.error';
  checkedAt: string;
}

export function urgentSignals(snapshot: SafeOperationsSnapshot): UrgentSignal[] {
  return snapshot.sites.flatMap((site) => {
    const signals: UrgentSignal[] = [];
    // Three failures in a row, either across runs or as retries within a single run.
    if (site.live === 'offline' && (site.failureStreak >= 3 || (site.failedAttempts ?? 0) >= 3)) {
      signals.push({ siteId: site.id, severity: 'outage', code: 'availability.failed-three-times', checkedAt: site.checkedAt });
    }
    if ((site.supabaseSecurity?.errors ?? 0) > 0) {
      signals.push({ siteId: site.id, severity: 'critical', code: 'security-advisor.error', checkedAt: site.checkedAt });
    }
    return signals;
  });
}

export function isTrustedDiscordWebhook(webhook: string | undefined): webhook is string {
  if (!webhook) return false;
  try {
    const parsed = new URL(webhook);
    const trustedHost = parsed.hostname === 'discord.com' || parsed.hostname === 'discordapp.com';
    return parsed.protocol === 'https:' && trustedHost && parsed.pathname.startsWith('/api/webhooks/');
  } catch {
    return false;
  }
}

function alertConfig() {
  const webhook = process.env.DISCORD_WEBHOOK_URL;
  return isTrustedDiscordWebhook(webhook) ? { webhook } : null;
}

export const signalKey = (signal: Pick<UrgentSignal, 'siteId' | 'code'>) => signal.siteId + ':' + signal.code;

/** Incident IDs are an HMAC of allowlisted fields when ALERT_FINGERPRINT_SECRET is set. */
export function incidentId(signal: UrgentSignal) {
  const material = signalKey(signal) + ':' + signal.checkedAt;
  const secret = process.env.ALERT_FINGERPRINT_SECRET;
  const digest = secret ? crypto.createHmac('sha256', secret) : crypto.createHash('sha256');
  return digest.update(material).digest('hex').slice(0, 16);
}

/**
 * Sends one alert when an incident opens, stays quiet while it remains open, and closes it once
 * the signal clears. Previously every monitoring run re-sent the same alert.
 */
export async function sendUrgentAlerts(snapshot: SafeOperationsSnapshot) {
  const config = alertConfig();
  const signals = urgentSignals(snapshot);
  const open = await openIncidents();
  const active = new Set(signals.map(signalKey));
  const recovered = [...open.values()].filter((incident) => !active.has(incident.key));
  if (recovered.length) await closeIncidents(recovered);
  if (!config) return { configured: false, sent: 0 };

  const fresh = signals.filter((signal) => !open.has(signalKey(signal)));
  const opened: OpenIncident[] = [];
  let sent = 0;
  for (const signal of fresh) {
    const id = incidentId(signal);
    const text = [
      'Command Deck urgent operational alert',
      '',
      `Site: ${signal.siteId}`,
      'Environment: production',
      `Severity: ${signal.severity}`,
      `Signal: ${signal.code}`,
      `Incident: ${id}`,
      `Observed: ${signal.checkedAt}`,
      '',
      'Metadata only: no raw logs, user identifiers, request data, database rows, or customer content.',
      process.env.HUB_DASHBOARD_URL ? `Dashboard: ${process.env.HUB_DASHBOARD_URL}` : '',
    ].filter(Boolean).join('\n');

    const response = await fetch(config.webhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, allowed_mentions: { parse: [] } }),
      signal: AbortSignal.timeout(8_000),
    });
    await response.body?.cancel();
    // Only a delivered alert opens the incident, so a failed delivery is retried next run.
    if (response.ok) {
      sent += 1;
      opened.push({ key: signalKey(signal), incidentId: id, siteId: signal.siteId, severity: signal.severity, code: signal.code, openedAt: signal.checkedAt });
    }
  }
  if (opened.length) await recordOpenIncidents(opened);
  return { configured: true, sent };
}
