import { describe, expect, it } from 'vitest';
import { awaitingPush, matchesInventory, releaseStatus } from './security-inventory';
import type { Project } from './types';

const project: Project = { id: 'app', name: 'App', kind: 'builder', root: 'fixture', description: '', teamId: 'team', allowedScripts: [], state: 'ready', exists: true, isGit: true, dirty: false, health: 'not-configured', workspaceLabel: '', lastActivity: '', gitStatus: { inspected: true, branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, dirty: false, checkedAt: '2026-10-09T00:00:00Z' } };

describe('cybersecurity inventory', () => {
  it('includes clean unpushed commits in the pending filter', () => {
    const pending = { ...project, gitStatus: { ...project.gitStatus!, ahead: 3 } };
    expect(awaitingPush(pending)).toBe(true);
    expect(releaseStatus(pending)).toBe('3 unpushed commits');
  });
  it('keeps production projects with local edits in both relevant views', () => {
    const dirty = { ...project, gitStatus: { ...project.gitStatus!, dirty: true } };
    expect(matchesInventory(dirty, 'pending', new Set(['app']))).toBe(true);
    expect(matchesInventory(dirty, 'production', new Set(['app']))).toBe(true);
    expect(matchesInventory(dirty, 'local', new Set(['app']))).toBe(false);
  });
  it('does not count unknown Git status as clean or awaiting push', () => {
    const unknown = { ...project, gitStatus: null };
    expect(releaseStatus(unknown)).toBe('Git status unavailable');
    expect(awaitingPush(unknown)).toBe(false);
    expect(matchesInventory(unknown, 'unavailable', new Set())).toBe(true);
  });
  it('marks an uninitialized local workspace for setup', () => {
    expect(releaseStatus({ ...project, isGit: false })).toBe('Initialize Git');
    expect(awaitingPush({ ...project, isGit: false })).toBe(true);
    expect(awaitingPush({ ...project, exists: false })).toBe(false);
  });
  it('keeps dirty state visible for a detached checkout', () => {
    expect(releaseStatus({ ...project, gitStatus: { ...project.gitStatus!, branch: null, upstream: null, dirty: true } })).toBe('Detached HEAD · Uncommitted changes');
  });
});
