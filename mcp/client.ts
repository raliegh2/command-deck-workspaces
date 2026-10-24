import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const deckUrl = (process.env.COMMAND_DECK_URL ?? 'http://127.0.0.1:8788').replace(/\/$/, '');

/** Errors carry only the API's operator-safe message. */
export class DeckError extends Error {}

function assertLoopback(url: string) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new DeckError('COMMAND_DECK_URL must point at 127.0.0.1 or localhost.');
}

/**
 * COMMAND_DECK_TOKEN wins; otherwise read the token the running server stored in its data folder.
 * Read on demand, so the MCP server can start before Command Deck does.
 */
async function readToken() {
  const fromEnv = process.env.COMMAND_DECK_TOKEN;
  if (fromEnv && fromEnv.length >= 32) return fromEnv;
  const dataDir = process.env.COMMAND_DECK_DATA_DIR ? path.resolve(process.env.COMMAND_DECK_DATA_DIR) : path.join(repoRoot, 'data');
  const token = (await fs.readFile(path.join(dataDir, 'api-token'), 'utf8').catch(() => '')).trim();
  if (token.length < 32) throw new DeckError('No Command Deck API token found. Start Command Deck (npm run dev) once, or set COMMAND_DECK_TOKEN.');
  return token;
}

export async function deck<T = unknown>(pathname: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  assertLoopback(deckUrl);
  const send = async () => fetch(deckUrl + pathname, {
    method: options.method ?? 'GET',
    headers: { Authorization: 'Bearer ' + await readToken(), ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(150_000),
  });
  let response: Response;
  try {
    response = await send();
  } catch (error) {
    if (error instanceof DeckError) throw error;
    throw new DeckError(`Command Deck is not reachable at ${deckUrl}. Start it with "npm run dev" in the command-deck-hub folder.`);
  }
  const body = await response.json().catch(() => ({})) as { error?: string };
  if (response.status === 401) throw new DeckError('Command Deck rejected the API token. Restart Command Deck, or make COMMAND_DECK_TOKEN match on both sides.');
  if (!response.ok) throw new DeckError(body.error ?? `Command Deck returned HTTP ${response.status}.`);
  return body as T;
}
