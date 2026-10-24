import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { runProcess, sanitizedEnv } from './processes.js';

describe('process runner', () => {
  it('kills a process that exceeds its timeout', async () => {
    const started = Date.now();
    const result = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { cwd: os.tmpdir(), timeoutMs: 500 });
    expect(result.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 20_000);

  it('never passes Command Deck or provider secrets to child processes', () => {
    process.env.VERCEL_TOKEN = 'v';
    process.env.DISCORD_WEBHOOK_URL = 'd';
    const env = sanitizedEnv({ CI: 'true' });
    expect(env.VERCEL_TOKEN).toBeUndefined();
    expect(env.DISCORD_WEBHOOK_URL).toBeUndefined();
    expect(env.CI).toBe('true');
    expect(env.PATH ?? env.Path).toBeDefined();
    delete process.env.VERCEL_TOKEN;
    delete process.env.DISCORD_WEBHOOK_URL;
  });

  it('redacts secrets from captured output', async () => {
    const result = await runProcess(process.execPath, ['-e', 'console.log("password=hunter22 user@example.com")'], { cwd: os.tmpdir(), timeoutMs: 10_000 });
    expect(result.outputTail).not.toContain('hunter22');
    expect(result.outputTail).not.toContain('user@example.com');
  });
});
