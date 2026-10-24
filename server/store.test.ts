import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let dataDir = '';
let store: typeof import('./store.js');

beforeAll(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'command-deck-store-'));
  process.env.COMMAND_DECK_DATA_DIR = dataDir;
  await fs.writeFile(path.join(dataDir, 'runtime.json'), '{ not json', 'utf8');
  store = await import('./store.js');
  await store.initStore();
});

afterAll(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

const change = (id: number, status: 'pending' | 'applied') => ({
  id: 'change_' + id, projectId: 'p', path: 'a.md', reason: 'r', content: 'x', baseHash: '0'.repeat(64), status, createdAt: new Date().toISOString(),
});

describe('runtime store', () => {
  it('preserves numeric retrieval scores and internal work identifiers while redacting secrets',async()=>{
    const workItemId='work_12345678-1234-4123-8123-123456789012';
    await store.enqueueConnectorMessage({workItemId,body:{score:0.01639344262295082,text:'contact alice@example.com',token:'private-credential'}});
    const message=JSON.parse((await fs.readFile(path.join(dataDir,'outbox.jsonl'),'utf8')).trim().split('\n').at(-1)!);
    expect(message).toMatchObject({workItemId,body:{score:0.01639344262295082,token:'[redacted-secret]'}});expect(message.body.text).not.toContain('alice@example.com');
    await store.initStore();const again=JSON.parse((await fs.readFile(path.join(dataDir,'outbox.jsonl'),'utf8')).trim().split('\n').at(-1)!);expect(again.body.score).toBe(message.body.score);
  });
  it('rewrites queued connector messages to the free local-only harness policy', () => {
    const message = JSON.stringify({ body: { advisoryHarnesses: ['deepseek', 'codex', 'claude'], coordinationMode: 'complementary-parallel' } }) + '\n';
    expect(store.enforceHarnessPolicyOnOutbox(message)).toBe(JSON.stringify({ body: { advisoryHarnesses: ['deepseek'], coordinationMode: 'local-deepseek-only' } }) + '\n');
  });

  it('keeps a corrupt state file for recovery instead of overwriting it', async () => {
    const files = await fs.readdir(dataDir);
    expect(files.some((name) => name.startsWith('runtime.corrupt-'))).toBe(true);
  });

  it('survives many concurrent writes and persists all of them', async () => {
    await Promise.all(Array.from({ length: 25 }, (_, index) => store.addActivity({ id: 'a' + index, at: new Date().toISOString(), message: 'm', source: 's', tone: 'blue' })));
    const saved = JSON.parse(await fs.readFile(path.join(dataDir, 'runtime.json'), 'utf8'));
    expect(saved.activity).toHaveLength(25);
  });

  it('bounds resolved changesets but never drops pending ones', async () => {
    for (let index = 0; index < 60; index += 1) await store.addChangeset(change(index, 'applied'));
    await store.addChangeset(change(999, 'pending'));
    for (let index = 60; index < 120; index += 1) await store.addChangeset(change(index, 'applied'));
    const { changesets } = store.getState();
    expect(changesets.filter((item) => item.status === 'applied')).toHaveLength(50);
    expect(changesets.some((item) => item.id === 'change_999')).toBe(true);
  });
});
