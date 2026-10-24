import fs from 'node:fs/promises';
import path from 'node:path';

export const vaultRoot = process.env.COMMAND_DECK_VAULT ?? path.resolve('data/vault');

interface IndexedNote { title: string; path: string; mtimeMs: number; content: string; lower: string }

const refreshMs = 60_000;
const maxResults = 30;
let index = new Map<string, IndexedNote>();
let indexedAt = 0;
let refreshing: Promise<void> | null = null;

export async function knowledgeStatus() {
  const stat = await fs.stat(vaultRoot).catch(() => null);
  return { connected: Boolean(stat?.isDirectory()), root: vaultRoot };
}

/**
 * Keeps an in-memory index of the vault. A refresh walks the folders but only re-reads notes
 * whose modification time changed, instead of reading every note on every search.
 */
async function refreshIndex() {
  const next = new Map<string, IndexedNote>();
  async function walk(directory: string) {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) await walk(absolute);
        continue;
      }
      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== '.md') continue;
      const stat = await fs.stat(absolute).catch(() => null);
      if (!stat) continue;
      const previous = index.get(absolute);
      if (previous && previous.mtimeMs === stat.mtimeMs) {
        next.set(absolute, previous);
        continue;
      }
      const content = await fs.readFile(absolute, 'utf8').catch(() => null);
      if (content === null) continue;
      next.set(absolute, {
        title: path.basename(entry.name, '.md'),
        path: path.relative(vaultRoot, absolute).replaceAll('\\', '/'),
        mtimeMs: stat.mtimeMs,
        content,
        lower: content.toLowerCase(),
      });
    }
  }
  await walk(vaultRoot);
  index = next;
  indexedAt = Date.now();
}

async function ensureIndex() {
  if (Date.now() - indexedAt < refreshMs) return;
  refreshing ??= refreshIndex().finally(() => { refreshing = null; });
  await refreshing;
}

export async function searchKnowledge(query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1);
  // Queries made only of one-letter words used to match every note in the vault.
  if (terms.length === 0) return [];
  await ensureIndex();
  const results: Array<{ title: string; path: string; excerpt: string }> = [];
  for (const note of index.values()) {
    if (!terms.every((term) => note.lower.includes(term))) continue;
    const firstMatch = Math.max(0, Math.min(...terms.map((term) => note.lower.indexOf(term))) - 90);
    results.push({
      title: note.title,
      path: note.path,
      excerpt: note.content.slice(firstMatch, firstMatch + 240).replace(/\s+/g, ' ').trim(),
    });
    if (results.length >= maxResults) break;
  }
  return results;
}
