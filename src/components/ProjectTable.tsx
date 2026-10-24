import { ArrowRight, FlaskConical, Link2, MonitorCog, Plus, ShieldCheck } from 'lucide-react';
import type { Project } from '../types';
import { Status } from './Status';

function ProjectIcon({ kind }: { kind: Project['kind'] }) {
  const props = { size: 19, strokeWidth: 1.65 };
  if (kind === 'security') return <ShieldCheck {...props} />;
  if (kind === 'builder') return <MonitorCog {...props} />;
  if (kind === 'integration') return <Link2 {...props} />;
  return <FlaskConical {...props} />;
}

export function ProjectTable({ projects, onSelect, onAdd, expanded = false }: {
  projects: Project[];
  onSelect: (project: Project) => void;
  onAdd: () => void;
  expanded?: boolean;
}) {
  return (
    <section className={expanded ? 'panel project-panel expanded' : 'panel project-panel'}>
      <div className="panel-heading">
        <h2>{expanded ? 'Registered projects' : 'Projects'}</h2>
        <button className="subtle-button" onClick={onAdd}><Plus size={17} />Add project</button>
      </div>
      <div className="project-table" role="table" aria-label="Registered projects">
        <div className="project-table-head" role="row">
          <span>Name</span><span>Status</span><span>Last activity</span><span>Workspace</span><span aria-label="Actions" />
        </div>
        {projects.map((project) => (
          <button className="project-row" role="row" key={project.id} onClick={() => onSelect(project)}>
            <span className="project-name"><ProjectIcon kind={project.kind} /><strong>{project.name}</strong></span>
            <Status state={project.state} />
            <span className="muted truncate">{project.lastActivity}</span>
            <span className={project.root ? 'workspace-path' : 'workspace-path warning'}>{project.root?'Local folder connected':'No local folder'}</span>
            <ArrowRight size={18} strokeWidth={1.5} />
          </button>
        ))}
      </div>
    </section>
  );
}
