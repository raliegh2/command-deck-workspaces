import { describe, expect, it } from 'vitest';
import { monitoringStatus, productionIncidents } from './production-alerts.js';

describe('production incident feed', () => {
  const now = Date.now();
  const healthy = { connected: true, monitoringEnabled: true, lastCheck: { at: new Date(now).toISOString(), conclusion: 'success', url: '' }, incidents: [] };
  it('does not report healthy when evidence is stale, disabled or unavailable', () => {
    expect(monitoringStatus(healthy, now)).toBe('passing');
    expect(monitoringStatus({ ...healthy, connected: false }, now)).toBe('unknown');
    expect(monitoringStatus({ ...healthy, monitoringEnabled: false }, now)).toBe('unknown');
    expect(monitoringStatus({ ...healthy, lastCheck: { ...healthy.lastCheck, at: new Date(now - 46 * 60_000).toISOString() } }, now)).toBe('stale');
    expect(monitoringStatus({ ...healthy, lastCheck: { ...healthy.lastCheck, conclusion: 'failure' } }, now)).toBe('check-failed');
  });
  it('excludes CI incidents and spoofed production issues while preserving recovery', () => {
    const issue = { number: 1, title: '[Production incident] Availability or application assets', state: 'open', created_at: '2026-10-16T00:00:00Z', closed_at: null, user: { login: 'github-actions[bot]' } };
    const incidents = productionIncidents([issue, { ...issue, number: 2, title: '[Pipeline incident] CI' }, { ...issue, number: 3, user: { login: 'someone' } }, { ...issue, number: 4, state: 'closed', closed_at: '2026-10-16T01:00:00Z' }], 'owner/repo');
    expect(incidents.map(item => item.number)).toEqual([1, 4]);
    expect(monitoringStatus({ ...healthy, incidents }, now)).toBe('incident');
    expect(monitoringStatus({ ...healthy, incidents: incidents.filter(item => item.state === 'closed') }, now)).toBe('passing');
  });
});
