import { Wrench, Bot, FolderKanban, Globe2, Home, MonitorCog, NotebookTabs, ShieldCheck, MessageSquareText } from 'lucide-react';
import type { NavigationId } from '../types';

const items = [
  { id: 'overview' as const, label: 'Home', icon: Home },
  { id: 'operations' as const, label: 'Operations', icon: MonitorCog },
  { id: 'assistant' as const, label: 'Local assistant', icon: MessageSquareText },
  { id: 'northstar' as const, label: 'North Star', icon: Globe2 },
  { id: 'tools' as const, label: 'Tools Workspace', icon: Wrench },
  { id: 'production' as const, label: 'Production', icon: MonitorCog },
  { id: 'security' as const, label: 'Cybersecurity', icon: ShieldCheck },
  { id: 'research' as const, label: 'Research desk', icon: Globe2 },
  { id: 'trading-intelligence' as const, label: 'Trading intelligence', icon: MonitorCog },
  { id: 'projects' as const, label: 'Projects', icon: FolderKanban },
  { id: 'agents' as const, label: 'Agent teams', icon: Bot },
  { id: 'knowledge' as const, label: 'Knowledge', icon: NotebookTabs },
];

export function Sidebar({ active, onChange }: { active: NavigationId; onChange: (id: NavigationId) => void }) {
  return (
    <aside className="sidebar">
      <nav aria-label="Primary">
        {items.map(({ id, label, icon: Icon }) => (
          <button className={active === id ? 'nav-item active' : 'nav-item'} onClick={() => onChange(id)} key={id}>
            <Icon size={20} strokeWidth={1.6} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
      <div className="local-note">
        <span />
        <p>Your local workspace.<br />Built to move ideas forward.</p>
      </div>
    </aside>
  );
}
