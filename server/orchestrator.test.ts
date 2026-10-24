import { describe, expect, it } from 'vitest';
import { pickProject } from './orchestrator.js';
import type { ProjectView } from './types.js';

const project = (id: string, name: string): ProjectView => ({
  id, name, kind: 'builder', root: null, description: 'x', teamId: 'build-studio', allowedScripts: [],
  state: 'ready', exists: true, isGit: false, dirty: false, health: 'not-configured', workspaceLabel: '', lastActivity: '',
});

const projects = [
  project('ddos-detector', 'DDoS Detector'),
  project('northstar', 'Northstar Website Studio'),
  project('example-care', 'Example Care'),
  project('example-planner', 'Example Planner'),
];

describe('request routing', () => {
  it('prefers a fully named project over a shared generic word', () => {
    expect(pickProject('fix the example care website login', projects)?.id).toBe('example-care');
  });

  it('honours an explicit project id over prompt text', () => {
    expect(pickProject('improve the website design', projects, 'example-planner')?.id).toBe('example-planner');
  });

  it('matches whole words only', () => {
    expect(pickProject('rename the studios folder', projects)?.id).not.toBe('northstar');
  });

  it('falls back to keyword routing', () => {
    expect(pickProject('investigate this packet flood', projects)?.id).toBe('ddos-detector');
  });
});
