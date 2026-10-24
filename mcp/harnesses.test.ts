import { afterEach, describe, expect, it } from 'vitest';
import {
  buildHarnessArgs,
  buildHarnessPrompt,
  compactHarnessOutput,
  configuredDeepSeekModel,
  harnessEnvironment,
} from './harnesses.js';

const originalEnvironment = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnvironment)) delete process.env[key];
  }
  Object.assign(process.env, originalEnvironment);
});

describe('Command Deck harness safety', () => {
  it('strips provider API credentials from every child process', () => {
    process.env.OPENAI_API_KEY = 'openai-secret';
    process.env.ANTHROPIC_API_KEY = 'anthropic-secret';
    process.env.ANTHROPIC_AUTH_TOKEN = 'anthropic-token';
    process.env.OLLAMA_API_KEY = 'fake-local-key';
    process.env.DEEPSEEK_API_KEY = 'deepseek-secret';
    process.env.AWS_ACCESS_KEY_ID = 'cloud-secret';
    process.env.GOOGLE_APPLICATION_CREDENTIALS = 'cloud-credentials.json';
    const env = harnessEnvironment();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.OLLAMA_API_KEY).toBeUndefined();
    expect(env.DEEPSEEK_API_KEY).toBeUndefined();
    expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBeUndefined();
  });

  it('keeps Codex ephemeral and read-only', () => {
    const args = buildHarnessArgs('codex', 'C:\\workspace', 'review this');
    expect(args).toContain('--ephemeral');
    expect(args).toContain('--ignore-user-config');
    expect(args.slice(args.indexOf('--sandbox'), args.indexOf('--sandbox') + 2)).toEqual(['--sandbox', 'read-only']);
    expect(args.join(' ')).not.toContain('dangerously');
  });

  it('keeps Claude restricted, non-persistent, and in plan mode', () => {
    const args = buildHarnessArgs('claude', 'C:\\workspace', 'review this');
    expect(args).toContain('--restricted');
    expect(args).toContain('--safe-mode');
    expect(args).toContain('--no-session-persistence');
    expect(args.slice(args.indexOf('--permission-mode'), args.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'plan']);
    expect(args.join(' ')).not.toContain('bypassPermissions');
  });

  it('accepts only local DeepSeek model names and uses the Ollama CLI', () => {
    process.env.COMMAND_DECK_DEEPSEEK_MODEL = 'hosted-model';
    expect(configuredDeepSeekModel()).toBe('deepseek-r1:1.5b');
    expect(buildHarnessArgs('deepseek', 'C:\\workspace', 'review this')).toEqual([
      'run', 'deepseek-r1:1.5b', '--hidethinking', '--nowordwrap', '--keepalive', '5m', 'review this',
    ]);
  });

  it('gives the harness a concise read-only management contract', () => {
    const prompt = buildHarnessPrompt('deepseek', 'Improve dispatch.', 'Command Deck (command-deck)');
    expect(prompt).toContain('read-only advisory mode');
    expect(prompt).toContain('Do not edit files');
    expect(prompt).toContain('Improve dispatch.');
  });

  it('bounds model output while retaining the beginning and end', () => {
    const output = compactHarnessOutput('start-' + 'x'.repeat(2000) + '-end', 1000);
    expect(output).toContain('Command Deck truncated');
    expect(output.startsWith('start-')).toBe(true);
    expect(output.endsWith('-end')).toBe(true);
    expect(output.length).toBeLessThan(1100);
  });
});
