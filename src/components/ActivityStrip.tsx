import type { Activity, Project } from '../types';

export function ActivityStrip({ activity, projects }: { activity: Activity[]; projects: Project[] }) {
  const derived: Activity[] = projects.slice(0, 4).map((project) => ({
    id: project.id,
    at: new Date().toISOString(),
    message: project.lastActivity,
    source: project.name,
    tone: project.state === 'needs-setup' ? 'amber' : project.kind === 'security' ? 'green' : 'blue',
  }));
  const entries = (activity.length ? activity : derived).slice(0, 4);
  return (
    <section className="panel activity-panel">
      <div className="panel-heading"><h2>System activity</h2><span className="view-hint">Live workspace state</span></div>
      <div className="activity-grid">
        {entries.map((entry) => (
          <article key={entry.id}>
            <span className={'activity-tick ' + entry.tone} />
            <div><time>{new Date(entry.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><strong>{entry.message}</strong><small>{entry.source}</small></div>
          </article>
        ))}
      </div>
    </section>
  );
}
