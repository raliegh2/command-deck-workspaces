import {WebsiteTesting} from './WebsiteTesting';
import {CloudDiscordStatus} from './CloudDiscordStatus';
import {useEffect,useState} from 'react';

import {RefreshCw,ExternalLink,Play,ShieldCheck,HardDrive,Search,FileText,Activity} from 'lucide-react';

import {request} from '../api';

import {localApi,errorMessage,type Job} from './local-client';

import type {Project} from '../types';

import './system-health.css';

type Status={capabilities:Array<{id:string;name:string;dependency:string|null;ready:boolean|null;lastSuccess:string|null;lastFailure:string|null;skill:string;input:string}>;at:string;dockerReady:boolean;services:Array<{id:string;name:string;url:string;ready:boolean}>;tools:Array<{name:string;ready:boolean}>;backup:{destination:string;enabled:boolean;lastBackup:string;lastRestoreTest:string};jobs:Job[];documentInbox:string;receiptsPath:string};

export function SystemHealth({projects,hosted}:{projects:Project[];hosted:boolean}){

 const [data,setData]=useState<Status|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(''),[project,setProject]=useState('command-deck'),[query,setQuery]=useState(''),[filename,setFilename]=useState(''),[destination,setDestination]=useState(''),[enabled,setEnabled]=useState(true),[selected,setSelected]=useState<Job|null>(null);

 const [documents,setDocuments]=useState<Array<{hash:string;markdown:string}>>([]);const [reviewsLoaded,setReviewsLoaded]=useState(false);

 async function reviewDocuments(){try{setDocuments((await request<{documents:Array<{hash:string;markdown:string}>}>('/api/local/system/documents')).documents);setReviewsLoaded(true);}catch(e){setError(errorMessage(e));}}

 async function approve(hash:string){try{await request('/api/local/system/documents/'+hash+'/approve',{method:'POST',body:'{}'});await reviewDocuments();}catch(e){setError(errorMessage(e));}}

 async function refresh(){try{const d=await request<Status>('/api/local/system');setData(d);setError('');return d;}catch(e){setError(errorMessage(e));}}

 useEffect(()=>{if(hosted)return;void refresh().then(d=>{if(d){setDestination(d.backup.destination);setEnabled(d.backup.enabled);}});const timer=setInterval(()=>void refresh(),10000);return()=>clearInterval(timer);},[hosted]);

 async function run(id:string,input:Record<string,unknown>={}){setBusy(id);setError('');try{const j=await localApi.run(id,project,input);setSelected(j);await refresh();}catch(e){setError(errorMessage(e));}finally{setBusy('');}}

 async function save(){setBusy('settings');try{await request('/api/local/system/settings',{method:'POST',body:JSON.stringify({backupDestination:destination,dailyBackup:enabled})});await refresh();}catch(e){setError(errorMessage(e));}finally{setBusy('');}}

 const current=selected?(data?.jobs.find(j=>j.id===selected.id)??selected):null;

 if(hosted)return <main className="system-main"><h1>System health & tasks</h1><p>Open your local Command Deck to run tools and inspect private system health.</p></main>;

 return <main className="system-main"><header className="system-heading"><div><h1>System health & tasks</h1><p>Build, verify and recover with local tools.</p></div><button onClick={()=>void refresh()} disabled={Boolean(busy)}><RefreshCw size={16}/> Refresh</button></header>

 {error&&<p role="alert" className="system-error">{error}</p>}

 <div className="system-policy"><ShieldCheck size={20}/><div><strong>Local inference | no paid fallback</strong><p>One heavy system task at a time. Web search uses public search engines. Downloads and vulnerability updates require internet.</p></div></div>
 <CloudDiscordStatus/>

 <section className="system-section"><div className="system-section-heading"><h2><Activity size={20}/> Service readiness</h2><button disabled={Boolean(busy)||!data?.dockerReady} onClick={()=>void run('system.services')}><Play size={15}/> Start services</button></div><button disabled={Boolean(busy)} onClick={()=>void run('system.model')}>Start local model</button><button disabled={Boolean(busy)||!data?.dockerReady} onClick={()=>void run('system.documents')}>Start Docling</button><p>{data?data.dockerReady?'Docker engine connected.':'Docker engine unavailable. Start Docker Desktop, then refresh.':'Checking local services...'}</p><div className="system-service-list">{data?.services.map(s=><div key={s.id}><span className={s.ready?'system-state ready':'system-state'}>{s.ready?'Running':'Not ready'}</span><strong>{s.name}</strong><a href={s.url} target="_blank" rel="noreferrer">Open <ExternalLink size={13}/></a></div>)}</div><p className="system-footnote">Connect production monitors to configure registered sites. Availability is separate from DDoS mitigation.</p><div className="system-dependencies">{data?.tools.map(t=><span key={t.name}>{t.name}: {t.ready?'available':'unavailable'}</span>)}</div></section>

 <section className="system-section"><h2>Tool capabilities &amp; skills</h2><p>Current dependencies, execution instructions and last successful run for every registered tool.</p><div className="system-capabilities">{data?.capabilities.map(t=><details key={t.id}><summary>{t.name} · {t.ready===true?'Ready':t.ready===false?'Dependency unavailable':'Checked on execution'}</summary><p>{t.skill}</p><p>Input: <code>{t.input}</code></p><p>Dependency: {t.dependency||'Registered tool runtime'} · Last success: {t.lastSuccess||'Not recorded'}</p>{t.lastFailure&&<p>{t.lastFailure}</p>}</details>)}</div></section><WebsiteTesting/><section className="system-section"><h2>Verify a project</h2><div className="system-controls"><label>Registered project<select value={project} onChange={e=>setProject(e.target.value)}>{projects.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><button disabled={Boolean(busy)} onClick={()=>void run('system.verify',{projectId:project})}>Test desktop & mobile</button><button disabled={Boolean(busy)} onClick={()=>void run('system.scan',{projectId:project})}>Scan dependencies</button><button disabled={Boolean(busy)} onClick={()=>void run('system.monitors')}>Connect production monitors</button></div><p>Browser checks capture screenshots and errors without submitting forms. Trivy scans dependencies and configuration without applying fixes.</p></section>

 <div className="system-two-column"><section className="system-section"><h2><Search size={20}/> Research</h2><form onSubmit={e=>{e.preventDefault();void run('system.search',{query});}}><label>Public search query<input value={query} onChange={e=>setQuery(e.target.value)} required minLength={2} maxLength={300} placeholder="Search public documentation"/></label><button disabled={Boolean(busy)||!query.trim()}>Search with SearXNG</button></form><p>Keep private notes and credentials out of search queries. Results appear in the task receipt below.</p></section>

 <section className="system-section"><h2><FileText size={20}/> Document ingestion</h2><p>Place a PDF, Word file or image in <code>{data?.documentInbox??'data/document-inbox'}</code>.</p><form onSubmit={e=>{e.preventDefault();void run('system.ingest',{filename});}}><label>Inbox filename<input value={filename} onChange={e=>setFilename(e.target.value)} required placeholder="Research notes.pdf"/></label><button disabled={Boolean(busy)||!filename}>Extract for review</button></form><p>The inbox is checked automatically each minute while the hub runs. Sanitized Markdown enters a review queue. It is not automatically published or treated as instructions.</p></section></div>

 <section className="system-section"><h2><HardDrive size={20}/> Backup & recovery</h2><label>Local backup folder<input value={destination} onChange={e=>setDestination(e.target.value)} placeholder="Absolute folder path"/></label><label className="system-checkbox"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> Daily encrypted backup while Command Deck is running</label><div className="system-controls"><button disabled={Boolean(busy)||!destination} onClick={()=>void save()}>Save backup settings</button><button disabled={Boolean(busy)} onClick={()=>void run('system.backup')}>Back up now</button><button disabled={Boolean(busy)||!data?.backup.lastBackup} onClick={()=>void run('system.restore-test')}>Test recovery</button></div><p>Last backup: {data?.backup.lastBackup||'Not completed'} | Last recovery test: {data?.backup.lastRestoreTest||'Not completed'}</p><p className="system-footnote">Your chosen local-folder backup does not protect against disk failure. Keep the backup password in a separate secure place; it is never displayed here.</p></section>

 <section className="system-section"><div className="system-section-heading"><h2>Review extracted documents</h2><button onClick={()=>void reviewDocuments()}>Load review queue</button></div><p>Inspect the text for confidential information and accuracy before adding it to Obsidian.</p>{reviewsLoaded&&!documents.length&&<p>No documents awaiting review.</p>}{documents.map(d=><details key={d.hash}><summary>Document {d.hash.slice(0,12)}</summary><pre>{d.markdown}</pre><button onClick={()=>void approve(d.hash)}>Approve local vault import</button></details>)}</section>

 <section className="system-section"><h2>Task execution receipts</h2><p>Each tool records its status, artifacts and next action. Sanitized execution metadata is saved to Obsidian.</p>{!data?.jobs.length?<p>No tasks recorded yet. Run a readiness check to begin.</p>:<div className="system-jobs">{data.jobs.slice(0,15).map(j=><button key={j.id} className={current?.id===j.id?'selected':''} onClick={()=>setSelected(j)}><span>{j.tool}</span><span>{j.status}</span><time>{new Date(j.updatedAt).toLocaleString()}</time></button>)}</div>}{current&&<details open><summary>{current.tool} | {current.status}</summary><pre>{current.error||JSON.stringify(current.result,null,2)||'Waiting for task completion...'}</pre></details>}</section>

 </main>;

}

