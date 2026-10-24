import { describe, expect, it } from 'vitest';
import { countAdvisorLevels, summarizeProviderEvents } from './privacy.js';

describe('operations privacy projection', () => {
  it('returns only bounded aggregate categories', () => {
    const result = summarizeProviderEvents([
      { level: 'error', message: 'user@example.com failed at https://example.test?a=secret' },
      { level: 'info', message: 'healthy' },
      { severity: 'fatal', text: 'database connection timeout' },
    ]);
    expect(result.count).toBe(2);
    expect(result.classes).toEqual({ application: 1, timeout: 1 });
    expect(JSON.stringify(result)).not.toMatch(/user@example|secret|https/);
  });

  it('counts advisor levels without retaining advisor content', () => {
    expect(countAdvisorLevels({ lints: [
      { level: 'WARN', name: 'RLS for customer@example.com' },
      { level: 'ERROR', name: 'secret' },
      { level: 'INFO', count: 2 },
    ] })).toEqual({ warnings: 1, errors: 1, info: 2 });
  });
});
