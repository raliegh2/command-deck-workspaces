import { ZodError } from 'zod';

/** An error whose message is written for the operator and is safe to return over HTTP. */
export class PublicError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = 'PublicError';
  }
}

/**
 * Converts any thrown value into a message that never exposes filesystem paths,
 * stack traces, or provider responses. Only PublicError and validation messages pass through.
 */
export function publicMessage(error: unknown, fallback: string) {
  if (error instanceof PublicError) return error.message;
  if (error instanceof ZodError) {
    const issue = error.issues[0];
    return issue ? `Invalid ${issue.path.join('.') || 'input'}: ${issue.message}` : fallback;
  }
  const code = (error as NodeJS.ErrnoException | null)?.code;
  if (code === 'ENOENT') return 'That file or folder does not exist.';
  if (code === 'EACCES' || code === 'EPERM') return 'Command Deck does not have permission to access that path.';
  return fallback;
}
