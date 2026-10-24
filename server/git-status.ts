import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export interface GitStatus {
  inspected: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number | null;
  behind: number | null;
  dirty: boolean;
  checkedAt: string;
}

export function parseGitStatus(output: string): Omit<GitStatus, 'checkedAt'> {
  const lines = output.split(/\r?\n/).filter(Boolean);
  const header = (name: string) => lines.find(line => line.startsWith(`# branch.${name} `))?.slice(name.length + 10) ?? null;
  const counts = header('ab')?.match(/^\+(\d+) -(\d+)$/);
  const branch = header('head');
  return {
    inspected: true,
    branch: branch === '(detached)' ? null : branch,
    upstream: header('upstream'),
    ahead: counts ? Number(counts[1]) : null,
    behind: counts ? Number(counts[2]) : null,
    dirty: lines.some(line => !line.startsWith('# ')),
  };
}

export async function inspectGitStatus(root: string): Promise<GitStatus> {
  const checkedAt = new Date().toISOString();
  try {
    const { stdout } = await run('git', ['status', '--porcelain=v2', '--branch'], {
      cwd: root, timeout: 5000, windowsHide: true,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    });
    return { ...parseGitStatus(stdout), checkedAt };
  } catch {
    return { inspected: false, branch: null, upstream: null, ahead: null, behind: null, dirty: false, checkedAt };
  }
}
