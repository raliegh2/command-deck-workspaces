import crypto from 'node:crypto';
import { PublicError } from './errors.js';
import { safePrompt } from './privacy.js';
import { addActivity, addWork, enqueueConnectorMessage } from './store.js';
import type { ProjectView, WorkItem } from './types.js';
import { memoryContext, neuralMemory } from './neural-memory.js';

const teams = {
  'security-cell': { name: 'Security Cell', steps: ['Inspect evidence and boundaries', 'Form a defensive hypothesis', 'Propose a testable change', 'Run security review'] },
  'build-studio': { name: 'Build Studio', steps: ['Clarify the user outcome', 'Map the experience and components', 'Implement in an isolated workspace', 'Run visual and functional QA'] },
  'integration-desk': { name: 'Integration Desk', steps: ['Map the active contracts', 'Trace the handoff', 'Propose a compatible adapter', 'Verify the end-to-end path'] },
  'knowledge-crew': { name: 'Knowledge Crew', steps: ['Search project context', 'Surface related decisions', 'Capture the outcome', 'Link artifacts to the project'] },
  'lessonplan-ops': { name: 'LessonPlan Ops', steps: ['Confirm the lesson-planning outcome', 'Inspect the production workspace', 'Prepare a reviewed changeset', 'Run release and security gates'] },
  'care-hub-ops': { name: 'Care Hub Ops', steps: ['Confirm the ministry workflow', 'Inspect the production workspace', 'Prepare a reviewed changeset', 'Run release and security gates'] },
  'portfolio-ops': { name: 'Portfolio Ops', steps: ['Confirm the portfolio outcome', 'Inspect the published experience', 'Prepare a reviewed changeset', 'Run presentation and security gates'] },
} as const;

/**
 * Scores how directly a prompt names a project. A full ID or full name outranks a single shared
 * word, so "the church care hub website" goes to Example Care rather than the Website Studio.
 */
function mentionScore(query: string, project: ProjectView) {
  const name = project.name.toLowerCase();
  if (query.includes(project.id) || query.includes(project.id.replaceAll('-', ' ')) || query.includes(name)) return 100;
  const words = name.split(/[\s–-]+/).filter((word) => word.length > 3);
  return words.filter((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(query)).length;
}

export function pickProject(prompt: string, projects: ProjectView[], projectId?: string) {
  if (projectId) {
    const pinned = projects.find((project) => project.id === projectId);
    if (pinned) return pinned;
  }
  const query = prompt.toLowerCase();
  let best: ProjectView | undefined;
  let bestScore = 0;
  for (const project of projects) {
    const score = mentionScore(query, project);
    if (score > bestScore) {
      best = project;
      bestScore = score;
    }
  }
  if (best) return best;
  if (/ddos|traffic|packet|network|attack/.test(query)) return projects.find((project) => project.id === 'ddos-detector');
  if (/malware|sample|sandbox|reverse engineer/.test(query)) return projects.find((project) => project.id === 'malware-lab');
  if (/website|site|page|design|frontend/.test(query)) return projects.find((project) => project.id === 'northstar');
  if (/codex|bridge|gpt|handoff|integration/.test(query)) return projects.find((project) => project.id === 'gpt-codex-bridge');
  return projects.find((project) => project.exists) ?? projects[0];
}

export async function dispatch(prompt: string, projects: ProjectView[], options: { projectId?: string } = {}) {
  const sanitizedPrompt = safePrompt(prompt);
  const project = pickProject(sanitizedPrompt, projects, options.projectId);
  if (!project) throw new PublicError('No projects are registered.');
  const requestedTeam = project.teamId in teams ? project.teamId as keyof typeof teams : 'integration-desk';
  const team = teams[requestedTeam];
  const blocked = !project.exists;
  const paidHarnessesEnabled = process.env.COMMAND_DECK_ENABLE_PAID_HARNESSES === '1';
  const item: WorkItem = {
    id: 'work_' + crypto.randomUUID(),
    prompt: sanitizedPrompt,
    title: titleFor(sanitizedPrompt),
    projectId: project.id,
    projectName: project.name,
    teamId: requestedTeam,
    teamName: team.name,
    status: blocked ? 'blocked' : 'queued',
    createdAt: new Date().toISOString(),
    summary: blocked
      ? project.name + ' was selected, but its local path must be registered before an agent can inspect or change it.'
      : 'Routed to ' + team.name + (paidHarnessesEnabled
        ? '. DeepSeek, Codex, and Claude are available as complementary advisory harnesses; reviewed changesets remain required before any source file is modified.'
        : '. Local DeepSeek is the only enabled advisory harness; reviewed changesets remain required before any source file is modified.'),
    steps: [...team.steps],
  };
  await addWork(item);
  await addActivity({
    id: crypto.randomUUID(),
    at: item.createdAt,
    message: blocked ? 'Request needs project setup' : 'Request routed for review',
    source: project.name,
    tone: blocked ? 'amber' : requestedTeam === 'security-cell' ? 'green' : 'blue',
  });
  await enqueueConnectorMessage({
    schemaVersion: '1.0',
    id: crypto.randomUUID(),
    type: 'task.requested',
    source: 'command-deck',
    target: 'codex-bridge',
    projectId: project.id,
    workItemId: item.id,
    timestamp: item.createdAt,
    body: {
      prompt: sanitizedPrompt,
      context: await memoryContext(sanitizedPrompt, project.id),
      team: requestedTeam,
      requiresProjectSetup: blocked,
      advisoryHarnesses: paidHarnessesEnabled ? ['deepseek', 'codex', 'claude'] : ['deepseek'],
      coordinationMode: paidHarnessesEnabled ? 'complementary-parallel' : 'local-deepseek-only',
    },
  });
  // Learn only the observed queue transition, never an unverified completion claim.
  try { (await neuralMemory()).event(item.id,project.id,'Work queued: '+item.title,`Command Deck recorded work ${item.id} at ${item.createdAt}. Status: ${item.status}. Team: ${requestedTeam}. No implementation, test or deployment is established by this queue event.`); } catch { /* Memory availability must not lose accepted work. */ }
  return item;
}

function titleFor(prompt: string) {
  const clean = prompt.trim().replace(/\s+/g, ' ');
  const sentence = clean.length > 62 ? clean.slice(0, 59).trim() + '…' : clean;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}
