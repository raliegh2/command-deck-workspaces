import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let vault = '';
let knowledge: typeof import('./knowledge.js');

beforeAll(async () => {
  vault = await fs.mkdtemp(path.join(os.tmpdir(), 'command-deck-vault-'));
  await fs.mkdir(path.join(vault, 'Projects'));
  await fs.mkdir(path.join(vault, '.obsidian'));
  await fs.writeFile(path.join(vault, 'Projects', 'DDoS.md'), 'Adaptive baseline for packet floods.', 'utf8');
  await fs.writeFile(path.join(vault, 'Other.md'), 'Lesson planning notes.', 'utf8');
  await fs.writeFile(path.join(vault, '.obsidian', 'Hidden.md'), 'packet floods hidden', 'utf8');
  process.env.COMMAND_DECK_VAULT = vault;
  knowledge = await import('./knowledge.js');
});

afterAll(async () => {
  await fs.rm(vault, { recursive: true, force: true });
});

describe('knowledge search', () => {
  it('finds notes containing every term, skipping hidden folders', async () => {
    const results = await knowledge.searchKnowledge('packet floods');
    expect(results.map((result) => result.path)).toEqual(['Projects/DDoS.md']);
  });

  it('does not match every note for one-letter queries', async () => {
    expect(await knowledge.searchKnowledge('a b')).toEqual([]);
  });
});
