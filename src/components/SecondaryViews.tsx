import {WorkspaceSearch} from './WorkspaceSearch';
import {WorkspaceDocuments} from './WorkspaceDocuments';
import type { AgentTeam, ChangeSet, Project, WorkItem } from '../types';
import { WorkList } from './WorkList';
import { NeuralMemoryPanel } from './NeuralMemoryPanel';

export function AgentsView({ teams }: { teams: AgentTeam[] }) {
  return (
    <div className="page-view">
      <div className="page-title"><div><h1>Agent teams</h1><p>Specialists are grouped by responsibility so each request has a clear owner and review path.</p></div></div>
      <div className="agent-directory">
        {teams.map((team) => (
          <section key={team.id} className="team-detail">
            <div><h2>{team.name}</h2><p>{team.description}</p></div>
            <ul>{team.roles.map((role) => <li key={role}>{role}</li>)}</ul>
          </section>
        ))}
      </div>
    </div>
  );
}

export function WorkView({ work, changesets, projects, onReview }: {
  work: WorkItem[];
  changesets: ChangeSet[];
  projects: Project[];
  onReview: (change: ChangeSet) => void;
}) {
  return (
    <div className="page-view">
      <div className="page-title"><div><h1>Work queue</h1><p>Requests become scoped plans. Source edits remain proposals until you review and apply them.</p></div></div>
      <WorkList work={work} expanded />
      <section className="panel changeset-panel">
        <div className="panel-heading"><h2>Changesets</h2><span className="view-hint">{changesets.filter((item) => item.status === 'pending').length} pending</span></div>
        {changesets.length === 0 ? <div className="empty-line">No source changes are awaiting review.</div> : changesets.map((item) => (
          <button className="changeset-row" key={item.id} onClick={() => item.status === 'pending' && onReview(item)}>
            <span className={'change-state ' + item.status} />
            <div><strong>{item.path}</strong><small>{projects.find((project) => project.id === item.projectId)?.name ?? item.projectId} · {item.reason}</small></div>
            <span>{item.status === 'pending' ? 'Review →' : item.status}</span>
          </button>
        ))}
      </section>
    </div>
  );
}

export function KnowledgeView({connected}:{connected:boolean;root:string}){return <div className="page-view"><div className="page-title"><div><h1>Knowledge</h1><p>Find your notes and add reviewed documents.</p></div><span>{connected?'Connected':'Needs setup'}</span></div><WorkspaceSearch initialProvider="notes"/><WorkspaceDocuments/><details><summary>Advanced memory tools</summary><NeuralMemoryPanel/></details></div>;}
