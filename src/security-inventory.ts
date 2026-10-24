import type { Project } from './types';

export type InventoryFilter = 'all' | 'production' | 'pending' | 'local' | 'unavailable';

export function releaseStatus(project: Project): string {
  if (!project.exists) return 'Local status unavailable';
  if (!project.isGit) return 'Initialize Git';
  const git = project.gitStatus;
  if (!git?.inspected) return 'Git status unavailable';
  const parts: string[] = [];
  if (!git.branch) parts.push('Detached HEAD');
  if (git.dirty) parts.push('Uncommitted changes');
  if (git.ahead) parts.push(`${git.ahead} unpushed commit${git.ahead === 1 ? '' : 's'}`);
  if (git.behind) parts.push(`${git.behind} commit${git.behind === 1 ? '' : 's'} behind`);
  if (git.branch && !git.upstream) parts.push('No upstream');
  return parts.join(' · ') || 'Matches cached upstream';
}

export function awaitingPush(project: Project): boolean {
  if (!project.exists) return false;
  if (!project.isGit) return true;
  const git = project.gitStatus;
  return Boolean(git?.inspected && (git.dirty || (git.ahead ?? 0) > 0 || (git.branch && !git.upstream)));
}

export function matchesInventory(project: Project, filter: InventoryFilter, productionIds: Set<string>): boolean {
  switch (filter) {
    case 'production': return productionIds.has(project.id);
    case 'pending': return awaitingPush(project);
    case 'local': return project.exists && !productionIds.has(project.id);
    case 'unavailable': return !project.exists || (project.isGit && !project.gitStatus?.inspected);
    default: return true;
  }
}
