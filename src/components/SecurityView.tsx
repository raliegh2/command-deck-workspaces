import { ExternalLink, LoaderCircle, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '../api';
import { awaitingPush, matchesInventory, releaseStatus } from '../security-inventory';
import type { InventoryFilter } from '../security-inventory';
import type { NavigationId, ProductionApp, Project, WorkItem } from '../types';
import {SecurityProgramPanel} from './SecurityProgramPanel';

const filters: Array<{ id: InventoryFilter; label: string }> = [
  { id: 'all', label: 'All projects' }, { id: 'production', label: 'Production' },
  { id: 'pending', label: 'Awaiting push' }, { id: 'local', label: 'Local development' },
  { id: 'unavailable', label: 'Status unavailable' },
];

export function SecurityView({ projects, work, hosted, onRefresh, onSelect, onAdd, onNavigate }: {
  projects: Project[]; work: WorkItem[]; hosted: boolean;
  onRefresh: () => Promise<void>; onSelect: (project: Project) => void;
  onAdd: () => void; onNavigate: (id: NavigationId) => void;
}) {
  const [filter, setFilter] = useState<InventoryFilter>('all');
  const [query, setQuery] = useState('');
  const [apps, setApps] = useState<ProductionApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let disposed = false;
    api.production().then(result => { if (!disposed) setApps(result.apps); })
      .catch(cause => { if (!disposed) setError(cause instanceof Error ? cause.message : 'Production evidence unavailable.'); })
      .finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, []);
  async function refresh() {
    setRefreshing(true); setError('');
    try {
      const [, result] = await Promise.all([onRefresh(), api.production(true)]);
      setApps(result.apps);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not refresh inventory. Try again.'); }
    finally { setRefreshing(false); }
  }
  const productionIds = new Set(apps.map(app => app.projectId));
  const visible = projects.filter(project => matchesInventory(project, filter, productionIds)
    && `${project.name} ${project.description}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="wide-view"><div className="page-view cybersecurity-view">
    <div className="page-title"><div><h1><ShieldCheck size={27} />Cybersecurity</h1><p>Manage security evidence and release readiness across production and local projects.</p></div>
      <div className="cyber-actions"><button className="subtle-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? <LoaderCircle size={16} className="spin" /> : <RefreshCw size={16} />}{refreshing ? 'Refreshing…' : 'Refresh status'}</button><button className="primary-button" disabled={hosted} onClick={onAdd}><Plus size={16} />Register project</button></div>
    </div>
    <p className="cyber-scope">{hosted ? 'Hosted metadata snapshot. Local changes and unpushed commits are available from the local Command Deck.' : 'Git comparisons use the checkout’s cached upstream. Refresh reads local status; it does not fetch, push, or deploy.'} Production registration and reachability do not certify production readiness.</p>
    <details><summary>Security programme and assessment evidence</summary><SecurityProgramPanel hosted={hosted} projects={projects}/></details>
    <section className="panel cyber-inventory" aria-label="Project security inventory">
      <div className="cyber-toolbar"><div className="cyber-filters" role="group" aria-label="Filter projects">{filters.map(item => <button key={item.id} aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>{item.label}<span>{projects.filter(project => matchesInventory(project, item.id, productionIds)).length}</span></button>)}</div>
        <label className="cyber-search">Search projects<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Name or description" /></label>
      </div>
      {loading ? <p role="status" className="cyber-note">Loading production evidence… Local inventory is available below.</p> : null}
      {error ? <p role="alert" className="cyber-note">{error} Use Refresh status to retry.</p> : null}
      <div className="cyber-table-wrap"><table className="cyber-table"><caption>Project security inventory · {visible.length} shown</caption><thead><tr><th scope="col">Project</th><th scope="col">Environment</th><th scope="col">Local release state</th><th scope="col">Security evidence</th><th scope="col">Manage</th></tr></thead><tbody>
        {visible.map(project => {
          const app = apps.find(item => item.projectId === project.id);
          const openWork = work.filter(item => item.projectId === project.id && item.status !== 'complete');
          const attention = app?.audit.gates.filter(gate => gate.status === 'action-needed').length ?? 0;
          const pending = awaitingPush(project);
          return <tr key={project.id}><th scope="row"><strong>{project.name}</strong><small>{project.description}</small>{project.remoteUrl ? <a href={project.remoteUrl} target="_blank" rel="noreferrer">Repository <ExternalLink size={12} /></a> : <small>No repository registered</small>}</th>
            <td data-label="Environment"><span className={app ? 'cyber-state production' : 'cyber-state'}>{app ? 'Production' : project.exists ? 'Local development' : 'Unverified'}</span><small>{app ? (hosted ? 'Hosted snapshot' : app.live.online ? 'URL responding' : 'URL not responding') : project.health === 'online' ? 'Service responding' : 'No production evidence loaded'}</small></td>
            <td data-label="Local release state"><span className={pending ? 'cyber-pending' : ''}>{releaseStatus(project)}</span>{project.gitStatus?.branch ? <small>Branch: {project.gitStatus.branch}</small> : null}{project.gitStatus?.checkedAt ? <small>Checked {new Date(project.gitStatus.checkedAt).toLocaleTimeString()}</small> : null}</td>
            <td data-label="Security evidence">{app ? <><span>{attention ? `${attention} gate${attention === 1 ? '' : 's'} ${attention === 1 ? 'needs' : 'need'} attention` : 'Review release gates'}</span><small>Dependency findings: {app.audit.lastRun ? app.audit.vulnerabilities.total : 'Not assessed'}</small><small>{app.audit.lastRun ? `Audit: ${new Date(app.audit.lastRun).toLocaleDateString()}` : 'No saved dependency audit'}</small></> : <span>Not assessed</span>}<small>{openWork.length} open work item{openWork.length === 1 ? '' : 's'}</small></td>
            <td data-label="Manage"><div className="cyber-row-actions"><button disabled={hosted || !project.exists} onClick={() => onSelect(project)}>Open workspace</button>{app ? <button onClick={() => { const url = new URL(window.location.href); url.searchParams.set('system', app.id); window.history.replaceState(null, '', url); onNavigate('production'); }}>Review production</button> : null}</div></td></tr>;
        })}
      </tbody></table></div>
      {!visible.length ? <p className="cyber-note" role="status">No projects match this filter. Clear the search, choose All projects, or register a workspace.</p> : null}
    </section>
    <section className="cyber-maintenance"><div><h2>GitHub maintenance activity</h2><p>Daily public repository checks run in a dedicated log repository. Reports identify the automation and leave application code unchanged.</p></div><a href="https://github.com/example-owner/project-maintenance-log" target="_blank" rel="noreferrer">Open maintenance log <ExternalLink size={15} /></a></section>
  </div></main>;
}
