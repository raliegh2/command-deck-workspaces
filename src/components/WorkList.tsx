import type { WorkItem } from '../types';

const label = {
  queued: 'Queued',
  'in-progress': 'In progress',
  'review-pending': 'Review pending',
  blocked: 'Blocked',
  complete: 'Complete',
};

export function WorkList({ work, expanded = false }: { work: WorkItem[]; expanded?: boolean }) {
  return (
    <section className={expanded ? 'panel work-panel expanded' : 'panel work-panel'}>
      <div className="panel-heading">
        <h2>{expanded ? 'Work queue' : 'Active work'}</h2>
        {!expanded ? <span className="view-hint">Latest requests</span> : null}
      </div>
      {work.length === 0 ? (
        <div className="empty-work">
          <span className="empty-pulse" />
          <div><strong>No work is waiting.</strong><p>Dispatch a request and its routing plan will appear here.</p></div>
        </div>
      ) : (
        <div className="work-list">
          {work.slice(0, expanded ? 30 : 4).map((item) => (
            <article className="work-row" key={item.id}>
              <span className={'work-dot ' + item.status} />
              <time>{timeLabel(item.createdAt)}</time>
              <div><strong>{item.title}</strong><small>{item.projectName}<span>›</span>{item.teamName}</small></div>
              <span className={'work-status ' + item.status}>{label[item.status]}</span>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function timeLabel(date: string) {
  const value = new Date(date);
  return Number.isNaN(value.getTime()) ? 'Now' : value.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
