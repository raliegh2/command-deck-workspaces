import {OperationsWorkspace} from './components/OperationsWorkspace';
import {ToolsWorkspace} from './components/ToolsWorkspace';
import './components/workspace-ui.css';
import {TradingIntelligence} from './components/TradingIntelligence';
import {LocalAssistant} from './components/LocalAssistant';
import {NorthstarStudio} from './components/NorthstarStudio';
import { CircleAlert, LoaderCircle, Menu, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { api } from './api';
import { AddProjectModal } from './components/AddProjectModal';
import { AgentRail } from './components/AgentRail';
import { AgentsView, KnowledgeView } from './components/SecondaryViews';
import { ActivityStrip } from './components/ActivityStrip';
import { Brand } from './components/Brand';
import { ChangesetReview } from './components/ChangesetReview';
import { CommandComposer } from './components/CommandComposer';
import { ProjectDrawer } from './components/ProjectDrawer';
import { ProjectTable } from './components/ProjectTable';
import { ProductionView } from './components/ProductionView';
import { ProductionAlertsPanel } from './components/ProductionAlertsPanel';
import {ResearchWorkspace} from './components/ResearchWorkspace';
import { SecurityView } from './components/SecurityView';
import { Sidebar } from './components/Sidebar';
import { WorkList } from './components/WorkList';
import type { ChangeSet, DashboardData, NavigationId, Project, WorkItem } from './types';

function route():NavigationId{const raw=decodeURIComponent(location.hash.slice(1)).split('/')[0];const aliases:Record<string,NavigationId>={engineering:'operations',system:'operations',work:'operations','local-tools':'tools','market-intelligence':'trading-intelligence','review-signals':'trading-intelligence'};const id=aliases[raw]??raw;return ['operations','tools','assistant','northstar','overview','production','security','research','trading-intelligence','projects','agents','knowledge'].includes(id)?id as NavigationId:'overview';}
export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [active,setActive]=useState<NavigationId>(route);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [reviewChange, setReviewChange] = useState<ChangeSet | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [dispatchResult, setDispatchResult] = useState<WorkItem | null>(null);
  const [error, setError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await api.dashboard());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Command Deck API is unavailable.');
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(()=>{const update=()=>{const raw=decodeURIComponent(location.hash.slice(1)).split('/')[0];if(['operations','tools','assistant','northstar','overview','production','security','research','trading-intelligence','projects','agents','knowledge','engineering','system','work','local-tools','market-intelligence','review-signals'].includes(raw))setActive(route());};window.addEventListener('hashchange',update);return()=>window.removeEventListener('hashchange',update);},[]);


  async function handleDispatch(prompt: string) {
    setDispatching(true);
    setDispatchResult(null);
    try {
      const item = await api.dispatch(prompt);
      setDispatchResult(item);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not route that request.');
    } finally {
      setDispatching(false);
    }
  }

  function navigate(id: NavigationId) {
    setActive(id==='work'||id==='engineering'||id==='system'?'operations':id==='local-tools'?'tools':id);
    window.history.replaceState(null, '', id === 'overview' ? window.location.pathname : `#${id}`);
  }

  if (!data) {
    return (
      <div className="loading-screen">
        <Brand />
        <LoaderCircle className="spin" />
        <p>{error || 'Opening Command Deck…'}</p>
        {error ? <button onClick={refresh}>Try again</button> : null}
      </div>
    );
  }

  const reviewProject = reviewChange ? data.projects.find((project) => project.id === reviewChange.projectId) : undefined;
  const hosted = data.deployment?.mode === 'hosted-read-only';

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="mobile-menu" aria-label="Toggle navigation" onClick={() => setMenuOpen(!menuOpen)}><Menu size={20} /></button>
        <Brand />
        <div className="topbar-right">
          <span className={hosted ? 'global-state hosted' : 'global-state'} title={data.deployment?.detail}><i />{hosted ? 'Hosted mirror' : 'Connected'}</span>
          <span className="divider" />
          <span className="profile">Local workspace</span>
        </div>
      </header>
      <div className={menuOpen ? 'sidebar-wrap open' : 'sidebar-wrap'}>
        <Sidebar active={active} onChange={(id) => { navigate(id); setMenuOpen(false); }} />
      </div>
      <div className="workspace">
        {active === 'operations' ? (<OperationsWorkspace projects={data.projects} work={data.work} changesets={data.changesets} onReview={setReviewChange} onRefresh={refresh} hosted={Boolean(hosted)}/>) : active === 'assistant' ? (
          <LocalAssistant projects={data.projects} hosted={Boolean(hosted)} />
        ) : active === 'northstar' ? (
          <NorthstarStudio hosted={Boolean(hosted)} />
        ) : active === 'tools' ? (
          <ToolsWorkspace projects={data.projects} hosted={Boolean(hosted)}/>
        ) : active === 'overview' ? (
          <>
            <main className="overview-main">
              <section className="v14-summary" aria-label="Workspace overview">
                <article><span>Projects</span><strong>{data.projects.length}</strong><small>Registered workspaces</small></article>
                <article><span>Active work</span><strong>{data.work.filter(item => ['queued', 'in-progress'].includes(item.status)).length}</strong><small>Queued or in progress</small></article>
                <article><span>Awaiting review</span><strong>{data.changesets.filter(item => item.status === 'pending').length}</strong><small>Proposals pending review</small></article>
              </section>
              <section className="command-zone">
                <h1>What are we solving today?</h1>
                <CommandComposer onDispatch={handleDispatch} busy={dispatching} disabled={hosted} />
                {dispatchResult ? (
                  <button className={'dispatch-result ' + dispatchResult.status} onClick={() => navigate('operations')}>
                    <span>{dispatchResult.status === 'blocked' ? <CircleAlert size={18} /> : <i />}</span>
                    <div><strong>{dispatchResult.teamName} has the request</strong><p>{dispatchResult.summary}</p></div>
                    <b>Open tasks →</b>
                  </button>
                ) : null}
              </section>
              <ProjectTable projects={data.projects} onSelect={setSelectedProject} onAdd={() => setShowAdd(true)} />
              <WorkList work={data.work} />
            </main>
            <AgentRail
              teams={data.teams}
              knowledgeConnected={data.knowledge.connected}
              onShowAgents={() => setActive('agents')}
              onShowKnowledge={() => setActive('knowledge')}
            />
            <ActivityStrip projects={data.projects} activity={data.activity} />
          </>
        ) : active === 'production' ? (
          <><ProductionAlertsPanel /><ProductionView onWorkQueued={(item) => { setDispatchResult(item); void refresh(); }} /></>
        ) : active === 'trading-intelligence' ? (
          <TradingIntelligence hosted={Boolean(hosted)} />
        ) : active === 'research' ? (
          <ResearchWorkspace hosted={Boolean(hosted)} />
        ) : active === 'security' ? (
          <SecurityView projects={data.projects} work={data.work} hosted={Boolean(hosted)} onRefresh={async () => { setData(await api.dashboard(true)); }} onSelect={setSelectedProject} onAdd={() => setShowAdd(true)} onNavigate={navigate} />
        ) : active === 'projects' ? (
          <main className="wide-view">
            <div className="page-view">
              <div className="page-title"><div><h1>Projects</h1><p>Open a project, inspect its status or add a local workspace.</p></div><button className="primary-button" onClick={() => setShowAdd(true)}><Plus size={17} />Add project</button></div>
              <ProjectTable projects={data.projects} onSelect={setSelectedProject} onAdd={() => setShowAdd(true)} expanded />
            </div>
          </main>
        ) : active === 'agents' ? (
          <main className="wide-view"><AgentsView teams={data.teams} /></main>
        ) : (
          <main className="wide-view"><KnowledgeView connected={data.knowledge.connected} root={data.knowledge.root} /></main>
        )}
      </div>
      {selectedProject ? <ProjectDrawer project={selectedProject} onClose={() => setSelectedProject(null)} onChanged={refresh} /> : null}
      {showAdd ? <AddProjectModal onClose={() => setShowAdd(false)} onAdded={refresh} /> : null}
      {reviewChange ? <ChangesetReview changeset={reviewChange} project={reviewProject} onClose={() => setReviewChange(null)} onApplied={refresh} /> : null}
      {error ? <button className="error-toast" onClick={() => setError('')}>{error}<span>×</span></button> : null}
    </div>
  );
}
