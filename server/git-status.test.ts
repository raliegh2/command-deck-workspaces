import { describe, expect, it } from 'vitest';
import { inspectGitStatus, parseGitStatus } from './git-status.js';

describe('read-only release status', () => {
  it('distinguishes clean unpushed commits from uncommitted changes', () => {
    const result = parseGitStatus('# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n');
    expect(result).toMatchObject({ inspected: true, branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, dirty: false });
  });
  it('represents a new branch with no upstream as unknown counts', () => {
    expect(parseGitStatus('# branch.oid (initial)\n# branch.head main\n? new-file.md\n')).toMatchObject({ branch: 'main', upstream: null, ahead: null, behind: null, dirty: true });
  });
  it('reports detached HEAD separately from a named branch', () => {
    expect(parseGitStatus('# branch.oid abc\n# branch.head (detached)\n')).toMatchObject({ branch: null, dirty: false });
  });
  it('does not turn an unavailable checkout into a clean result', async () => {
    expect(await inspectGitStatus('Z:/nonexistent-command-deck-test-checkout')).toMatchObject({ inspected: false, ahead: null, upstream: null });
  });
});
