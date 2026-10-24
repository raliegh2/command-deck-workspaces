import { describe, expect, it } from 'vitest';
import { containsSensitiveText, redactSensitiveText, safePrompt } from './privacy.js';

describe('privacy boundary', () => {
  it('redacts common customer and credential identifiers before persistence', () => {
    const source = 'user@example.com 192.168.1.10 86d95ef4-7463-4e70-8f7f-a4c281ce4e65 token=abc1234567890 Bearer very-secret-token-value';
    const output = redactSensitiveText(source);
    expect(output).not.toContain('user@example.com');
    expect(output).not.toContain('192.168.1.10');
    expect(output).not.toContain('86d95ef4');
    expect(output).not.toContain('abc1234567890');
    expect(output).not.toContain('very-secret-token-value');
  });

  it('drops URL query values and absolute workstation paths', () => {
    const output = redactSensitiveText('See https://example.com/reset?token=secret at C:\\Users\\person\\private.txt');
    expect(output).toContain('https://example.com/reset?[redacted-query]');
    expect(output).not.toContain('token=secret');
    expect(output).not.toContain('C:\\Users');
  });

  it('keeps a usable, bounded prompt after redaction', () => {
    const output = safePrompt(' Fix the login for person@example.com \n now ');
    expect(output).toBe('Fix the login for [redacted-email] now');
    expect(containsSensitiveText(output)).toBe(false);
  });
});
