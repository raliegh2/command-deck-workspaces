const emailPattern = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const ipv4Pattern = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const jwtPattern = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi;
const secretAssignmentPattern = /\b(api[_-]?key|token|secret|password|authorization|cookie|session)\s*[:=]\s*([^\s,;]+)/gi;
const cardLikePattern = /\b(?:\d[ -]*?){13,19}\b/g;
const absoluteWindowsPathPattern = /\b[A-Z]:\\(?:[^\s<>:"|?*]+\\)*[^\s<>:"|?*]*/gi;
const queryPattern = /(https?:\/\/[^\s?#]+)\?[^\s#]*/gi;

export function redactSensitiveText(input: string) {
  return input
    .replace(queryPattern, '$1?[redacted-query]')
    .replace(emailPattern, '[redacted-email]')
    .replace(ipv4Pattern, '[redacted-ip]')
    .replace(jwtPattern, '[redacted-token]')
    .replace(uuidPattern, '[redacted-id]')
    .replace(bearerPattern, 'Bearer [redacted-token]')
    .replace(secretAssignmentPattern, '$1=[redacted-secret]')
    .replace(cardLikePattern, '[redacted-number]')
    .replace(absoluteWindowsPathPattern, '[redacted-path]');
}

export function safePrompt(input: string) {
  return redactSensitiveText(input).trim().replace(/\s+/g, ' ').slice(0, 4000);
}

export function safeErrorCategory(error: unknown) {
  const value = error instanceof Error ? error.name : typeof error;
  if (/abort|timeout/i.test(value)) return 'timeout';
  if (/syntax/i.test(value)) return 'invalid-response';
  if (/type/i.test(value)) return 'integration-error';
  return 'operation-failed';
}

export function containsSensitiveText(input: string) {
  const redacted = redactSensitiveText(input);
  return redacted !== input;
}
