import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyProjectFile, hash, readProjectFile, safeProjectPath } from './projects.js';
import type { ProjectConfig } from './types.js';

let testRoot = '';
let project: ProjectConfig;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'command-deck-test-'));
  await fs.writeFile(path.join(testRoot, 'note.md'), 'before\n', 'utf8');
  project = {
    id: 'fixture',
    name: 'Fixture',
    kind: 'other',
    root: testRoot,
    description: 'Test fixture',
    teamId: 'integration-desk',
    allowedScripts: [],
  };
});

afterEach(async () => {
  if (path.basename(testRoot).startsWith('command-deck-test-')) {
    await fs.rm(testRoot, { recursive: true, force: true });
  }
});

describe('project gateway', () => {
  it('reads an allowlisted text file and returns its content hash', async () => {
    const file = await readProjectFile(project, 'note.md');
    expect(file.content).toBe('before\n');
    expect(file.hash).toBe(hash('before\n'));
  });

  it('rejects traversal and protected paths', async () => {
    await expect(safeProjectPath(project, '../outside.ts')).rejects.toThrow('escaped');
    await expect(safeProjectPath(project, '.env', { forWrite: true })).rejects.toThrow('protected');
    await expect(safeProjectPath(project, '.git/config')).rejects.toThrow('protected');
  });

  it('applies a hash-checked changeset atomically', async () => {
    const newHash = await applyProjectFile(project, 'note.md', 'after\n', hash('before\n'));
    expect(newHash).toBe(hash('after\n'));
    expect(await fs.readFile(path.join(testRoot, 'note.md'), 'utf8')).toBe('after\n');
  });

  it('refuses a stale changeset', async () => {
    await fs.writeFile(path.join(testRoot, 'note.md'), 'changed elsewhere\n', 'utf8');
    await expect(applyProjectFile(project, 'note.md', 'after\n', hash('before\n'))).rejects.toThrow('changed');
  });
});

describe('project gateway on Windows aliasing and secret files', () => {
  beforeEach(async () => {
    await fs.writeFile(path.join(testRoot, '.env'), 'SECRET=value\n', 'utf8');
    for (const name of ['.npmrc', 'id_rsa', 'prod.env', 'credentials.json', 'README']) await fs.writeFile(path.join(testRoot, name), 'x', 'utf8');
  });

  it.each(['.env::$DATA', '.env:$DATA', 'ENV~1', 'README~1', '.env.', '.env ', 'note.md::$DATA'])('rejects the alias %j', async (alias) => {
    await expect(readProjectFile(project, alias)).rejects.toThrow('protected');
  });

  it.each(['.npmrc', 'id_rsa', 'prod.env', 'credentials.json', 'nested/.git-credentials'])('rejects the credential file %j', async (name) => {
    await expect(readProjectFile(project, name)).rejects.toThrow(/protected|Only text-based/);
  });

  it('still opens ordinary extension-less source files', async () => {
    expect((await readProjectFile(project, 'README')).content).toBe('x');
  });

  it('does not reveal absolute paths when a file is missing', async () => {
    const error = await readProjectFile(project, 'missing.md').catch((cause: Error) => cause);
    expect((error as Error).message).not.toContain(testRoot);
  });

  it('rejects paths that resolve through a junction to outside the project', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'command-deck-outside-'));
    await fs.writeFile(path.join(outside, 'leak.md'), 'outside', 'utf8');
    await fs.symlink(outside, path.join(testRoot, 'linked'), 'junction');
    try {
      await expect(readProjectFile(project, 'linked/leak.md')).rejects.toThrow('escape');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });
});
