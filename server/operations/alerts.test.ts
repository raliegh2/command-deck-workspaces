import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SafeOperationsSnapshot } from '../types.js';
import { incidentId, sendUrgentAlerts, urgentSignals } from './alerts.js';

type Site = SafeOperationsSnapshot['sites'][number];
const site = (overrides: Partial<Site>): Site => ({
  id: 'a', live: 'offline', statusCode: null, providerErrors: null, providerErrorClasses: {}, supabaseSecurity: null, failureStreak: 0, checkedAt: '2026-09-09T12:00:00.000Z', ...overrides,
});
const snapshot = (...sites: Site[]): SafeOperationsSnapshot => ({ schemaVersion: '1.0', lastRun: '2026-09-09T12:00:00.000Z', sites });

let dataDir = '';

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'command-deck-alerts-'));
  process.env.COMMAND_DECK_DATA_DIR = dataDir;
});

afterEach(async () => {
  delete process.env.DISCORD_WEBHOOK_URL;
  delete process.env.ALERT_FINGERPRINT_SECRET;
  delete process.env.COMMAND_DECK_DATA_DIR;
  vi.restoreAllMocks();
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe('urgent operations signals', () => {
  it('requires three availability failures and escalates advisor errors', () => {
    const signals = urgentSignals(snapshot(
      site({ id: 'a', failureStreak: 2 }),
      site({ id: 'b', failureStreak: 3, supabaseSecurity: { warnings: 0, errors: 1, info: 0 } }),
    ));
    expect(signals.map((signal) => signal.code)).toEqual(['availability.failed-three-times', 'security-advisor.error']);
  });

  it('confirms an outage from three failed attempts within one run', () => {
    expect(urgentSignals(snapshot(site({ failedAttempts: 3 })))).toHaveLength(1);
    expect(urgentSignals(snapshot(site({ failedAttempts: 1 })))).toHaveLength(0);
  });

  it('delivers a redacted payload to a trusted Discord webhook', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/secret';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 200 }));
    const result = await sendUrgentAlerts(snapshot(site({ id: 'example-care', failureStreak: 3 })));
    expect(result).toEqual({ configured: true, sent: 1 });
    expect(fetchMock).toHaveBeenCalledWith('https://discord.com/api/webhooks/123/secret', expect.objectContaining({ method: 'POST' }));
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.allowed_mentions).toEqual({ parse: [] });
    expect(body.content).toContain('example-care');
    expect(body.content).not.toContain('discord.com/api/webhooks');
  });

  it('alerts once per incident, then again only after recovery', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/secret';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('', { status: 200 }));
    const down = snapshot(site({ failureStreak: 3 }));
    expect((await sendUrgentAlerts(down)).sent).toBe(1);
    expect((await sendUrgentAlerts(down)).sent).toBe(0);
    await sendUrgentAlerts(snapshot(site({ live: 'online', failureStreak: 0 })));
    expect((await sendUrgentAlerts(down)).sent).toBe(1);
  });

  it('retries on the next run when delivery fails', async () => {
    process.env.DISCORD_WEBHOOK_URL = 'https://discord.com/api/webhooks/123/secret';
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 500 }));
    const down = snapshot(site({ failureStreak: 3 }));
    expect((await sendUrgentAlerts(down)).sent).toBe(0);
    fetchMock.mockResolvedValueOnce(new Response('', { status: 200 }));
    expect((await sendUrgentAlerts(down)).sent).toBe(1);
  });

  it('rejects non-Discord and non-HTTPS webhook destinations', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    for (const url of ['https://example.com/collect', 'http://discord.com/api/webhooks/1/x']) {
      process.env.DISCORD_WEBHOOK_URL = url;
      expect(await sendUrgentAlerts(snapshot(site({ failureStreak: 3 })))).toEqual({ configured: false, sent: 0 });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('derives incident IDs with an HMAC when a fingerprint secret is set', () => {
    const signal = { siteId: 'a', severity: 'outage' as const, code: 'availability.failed-three-times' as const, checkedAt: '2026-09-09T12:00:00.000Z' };
    const plain = incidentId(signal);
    process.env.ALERT_FINGERPRINT_SECRET = 'fingerprint-secret';
    expect(incidentId(signal)).toMatch(/^[a-f0-9]{16}$/);
    expect(incidentId(signal)).not.toBe(plain);
  });
});
