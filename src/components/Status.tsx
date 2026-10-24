import type { ProjectState } from '../types';

const labels: Record<ProjectState, string> = {
  connected: 'Connected',
  ready: 'Ready',
  paused: 'Paused',
  'needs-setup': 'Needs setup',
};

export function Status({ state }: { state: ProjectState }) {
  return <span className={'status status-' + state}><i />{labels[state]}</span>;
}
