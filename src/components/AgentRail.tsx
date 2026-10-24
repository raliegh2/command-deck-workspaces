import { BookOpen, Braces, Link2, Shield } from 'lucide-react';
import type { AgentTeam } from '../types';

const icons = { 'security-cell': Shield, 'build-studio': Braces, 'integration-desk': Link2, 'knowledge-crew': BookOpen };

export function AgentRail({ teams, knowledgeConnected, onShowAgents, onShowKnowledge }: {
  teams: AgentTeam[];
  knowledgeConnected: boolean;
  onShowAgents: () => void;
  onShowKnowledge: () => void;
}) {
  return (
    <aside className="agent-rail">
      <section className="panel agents-panel">
        <div className="panel-heading">
          <h2>Agent teams</h2>
          <button className="text-button" onClick={onShowAgents}>View all <span>→</span></button>
        </div>
        <div className="team-list">
          {teams.map((team, index) => {
            const Icon = icons[team.id as keyof typeof icons] ?? Braces;
            return (
              <button className="team-row" key={team.id} onClick={onShowAgents}>
                <span className={'team-icon ' + team.color}><Icon size={24} strokeWidth={1.55} /></span>
                <span className="team-copy"><strong>{team.name}</strong><small>{team.description}</small></span>
                <span className="team-capacity"><small>{team.roles.length} agents</small><i><b style={{ width: (35 + index * 12) + '%' }} /></i></span>
              </button>
            );
          })}
        </div>
      </section>
      <section className="panel system-panel">
        <div className="panel-heading"><h2>Connected systems</h2></div>
        <button className="system-row" onClick={onShowKnowledge}>
          <span className="team-icon neutral"><BookOpen size={23} strokeWidth={1.55} /></span>
          <strong>Second Brain</strong>
          <span className={knowledgeConnected ? 'system-state connected' : 'system-state'}><i />{knowledgeConnected ? 'Connected' : 'Needs setup'}</span>
          <span>→</span>
        </button>
      </section>
    </aside>
  );
}
