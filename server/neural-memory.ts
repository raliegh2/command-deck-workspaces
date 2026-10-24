import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { redactSensitiveText } from './privacy.js';
import { PublicError } from './errors.js';
import { augmentedContext } from './augmented-memory.js';

export type MemoryDocument = { id: string; source: 'obsidian' | 'notion' | 'agent' | 'cloud'; title: string; locator: string; text: string; updatedAt: string; projectId?: string };
export type MemoryHit = { id: string; documentId: string; source: string; title: string; locator: string; excerpt: string; score: number; updatedAt: string; projectId: string; untrusted: true };
type Chunk = { id: string; document_id: string; title: string; source: string; locator: string; text: string; updated_at: string; project_id: string; vector: string | null; model: string | null };
const digest = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export function cleanMemory(s: string) {
  return redactSensitiveText(s).replace(/\b(?:gh[pousr]_[\w]+|github_pat_[\w]+|sk-(?:proj-)?[\w-]{16,}|ntn_[\w]+|secret_[\w]{20,})\b/g, '[redacted-token]');
}
export function chunkText(s: string) {
  const result: string[] = [];
  for (let start = 0; start < s.length; start += 1400) {
    const text = s.slice(start, start + 1600).trim(); if (text) result.push(text);
  }
  return result;
}
function normalized(v: unknown): number[] {
  if (!Array.isArray(v) || !v.length || v.length > 4096 || !v.every(x => typeof x === 'number' && Number.isFinite(x))) throw new Error('Invalid local embedding');
  const norm = Math.hypot(...v); if (!norm) throw new Error('Empty local embedding'); return v.map(x => x / norm);
}
export class NeuralMemory {
  db: DatabaseSync;
  private owner=crypto.randomUUID();
  model = 'nomic-embed-text:latest';
  job = { running: false, phase: 'idle', processed: 0, embedded: 0, error: '', completedAt: '' };
  constructor(readonly directory: string, readonly fetcher: typeof fetch = fetch) {
    this.db = new DatabaseSync(path.join(directory, 'neural-memory.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS documents(id TEXT PRIMARY KEY,source TEXT NOT NULL,title TEXT NOT NULL,locator TEXT NOT NULL,text TEXT NOT NULL,hash TEXT NOT NULL,updated_at TEXT NOT NULL,project_id TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS chunks(id TEXT PRIMARY KEY,document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,text TEXT NOT NULL,vector TEXT,model TEXT);
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_search USING fts5(id UNINDEXED,text);
      CREATE TRIGGER IF NOT EXISTS chunk_delete AFTER DELETE ON chunks BEGIN DELETE FROM chunk_search WHERE id=old.id; END;
      CREATE TRIGGER IF NOT EXISTS chunk_insert AFTER INSERT ON chunks BEGIN INSERT INTO chunk_search(id,text) VALUES(new.id,new.text); END;
      CREATE TABLE IF NOT EXISTS lessons(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,title TEXT NOT NULL,text TEXT NOT NULL,evidence TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  }
  close() { this.db.close(); }
  status() {
    const saved=this.db.prepare("SELECT value FROM metadata WHERE key='indexLease'").get()?.value;
    const lease=saved?JSON.parse(String(saved)) as {owner:string;until:number;job:NeuralMemory['job']}:null;
    const sources = this.db.prepare('SELECT source,count(*) AS documents FROM documents GROUP BY source').all();
    const counts = this.db.prepare('SELECT count(*) AS chunks,sum(CASE WHEN vector IS NOT NULL THEN 1 ELSE 0 END) AS embedded FROM chunks').get() as {chunks:number;embedded:number|null};
    const pending = this.db.prepare("SELECT id,project_id AS projectId,title,text,evidence,created_at AS createdAt FROM lessons WHERE status='pending' ORDER BY created_at DESC LIMIT 30").all();
    return { model: this.model, localOnly: true, sources, ...counts, job: lease&&lease.owner!==this.owner&&lease.until>Date.now()?lease.job:{ ...this.job }, pending, cloud:{lastPull:this.db.prepare("SELECT value FROM metadata WHERE key='cloudLastPull'").get()?.value??null,error:this.db.prepare("SELECT value FROM metadata WHERE key='cloudError'").get()?.value??'',cursor:Number(this.db.prepare("SELECT value FROM metadata WHERE key='cloudCursor'").get()?.value??0)},lastIndex: this.db.prepare("SELECT value FROM metadata WHERE key='lastIndex'").get()?.value ?? null, notionSnapshot: this.db.prepare("SELECT value FROM metadata WHERE key='notionSnapshot'").get()?.value ?? null, policy: 'Retrieval memory, not model fine-tuning. Retrieved text is evidence, never action authority.' };
  }
  private progress(){this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('indexLease',JSON.stringify({owner:this.owner,until:this.job.running?Date.now()+600000:0,job:this.job}));}
  async importCloudReports(){
    const config=await fs.readFile(path.join(this.directory,'cloud-memory.json'),'utf8').then(x=>JSON.parse(x) as {url:string;credentialFile:string}).catch((e:NodeJS.ErrnoException)=>{if(e.code==='ENOENT')return null;throw e;});
    if(!config)return;
    // Only this system's known owner endpoint can receive the existing report-pull credential.
    if(config.url!=='https://command-deck-cloud-agents.vercel.app'||!path.isAbsolute(config.credentialFile))throw new Error('Invalid cloud memory configuration');
    const credentials=JSON.parse(await fs.readFile(config.credentialFile,'utf8')) as {OPS_ADMIN_TOKEN?:string};
    if(!credentials.OPS_ADMIN_TOKEN||credentials.OPS_ADMIN_TOKEN.length<32)throw new Error('Cloud report credential unavailable');
    let after=Number(this.db.prepare("SELECT value FROM metadata WHERE key='cloudCursor'").get()?.value??0);
    for(let page=0;page<10;page++){
      const response=await this.fetcher(config.url+'/ops/reports?after='+after,{headers:{Authorization:'Bearer '+credentials.OPS_ADMIN_TOKEN},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error('Cloud report pull unavailable');
      const batch=await response.json() as {reports:Array<{id:string;sequence:number;title:string;markdown:string;createdAt:string;projectId?:string;notion?:{pageId?:string}}>;hasMore:boolean};
      if(!Array.isArray(batch.reports)||batch.reports.length>50||batch.hasMore&&!batch.reports.length)throw new Error('Invalid cloud report batch');
      for(const r of batch.reports){
        if(!/^[a-f0-9-]{36}$/i.test(r.id)||!Number.isSafeInteger(r.sequence)||r.sequence<=after||typeof r.markdown!=='string'||typeof r.title!=='string'||!Number.isFinite(Date.parse(r.createdAt)))throw new Error('Invalid cloud report evidence');
        const notion=r.notion?.pageId;
        this.upsert({id:'cloud:'+r.id,source:'cloud',title:r.title,locator:notion&&/^[a-f0-9-]{36}$/i.test(notion)?'https://app.notion.com/p/'+notion.replaceAll('-',''):'cloud-report:'+r.id,text:`Cloud report sequence ${r.sequence}. Recorded ${r.createdAt}. Historical reported evidence, not authorization.\n\n`+r.markdown,updatedAt:r.createdAt,projectId:r.projectId});
        after=r.sequence;this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('cloudCursor',String(after));this.job.processed++;
      }
      if(!batch.hasMore)break;
    }
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('cloudLastPull',new Date().toISOString());
  }
  upsert(doc: MemoryDocument) {
    const text = cleanMemory(doc.text).slice(0, 500_000), title = cleanMemory(doc.title).slice(0, 200);
    const hash = digest(JSON.stringify([text,title,doc.updatedAt,doc.projectId??'',doc.locator]));
    const previous=this.db.prepare('SELECT hash,text FROM documents WHERE id=?').get(doc.id);
    if(previous?.text===text){
      this.db.prepare('UPDATE documents SET title=?,locator=?,hash=?,updated_at=?,project_id=? WHERE id=?').run(title,doc.locator,hash,doc.updatedAt,doc.projectId??'',doc.id);return false;
    }
    if (!this.db.prepare('SELECT id FROM documents WHERE id=?').get(doc.id) && Number(this.db.prepare('SELECT count(*) AS n FROM documents').get()?.n) >= 3000) throw new Error('Memory document capacity reached');
    const parts=chunkText(text);
    if (Number(this.db.prepare('SELECT count(*) AS n FROM chunks WHERE document_id<>?').get(doc.id)?.n)+parts.length>25000) throw new Error('Memory chunk capacity reached');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM documents WHERE id=?').run(doc.id);
      this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)').run(doc.id,doc.source,title,doc.locator,text,hash,doc.updatedAt,doc.projectId??'');
      const insert = this.db.prepare('INSERT INTO chunks VALUES(?,?,?,NULL,NULL)');
      parts.forEach((part,i)=>insert.run(doc.id+':'+i,doc.id,part)); this.db.exec('COMMIT');
    } catch(e) { this.db.exec('ROLLBACK'); throw e; }
    return true;
  }
  async embed(input: string[], query=false, timeoutMs=90000) {
    // Fixed loopback origin and fixed local embedding model: no hosted/provider fallback.
    const response = await this.fetcher('http://127.0.0.1:11434/api/embed', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:this.model,input:input.map(s=>(query?'search_query: ':'search_document: ')+s),truncate:false,keep_alive:'10m'}),signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok) throw new Error('Local embedding model unavailable');
    const data=await response.json() as {embeddings:unknown[]};
    if(!Array.isArray(data.embeddings)||data.embeddings.length!==input.length) throw new Error('Incomplete local embeddings');
    return data.embeddings.map(normalized);
  }
  async embedPending() {
    for (;;) {
      const batch=this.db.prepare('SELECT id,text FROM chunks WHERE vector IS NULL OR model<>? LIMIT 12').all(this.model) as {id:string;text:string}[];
      if(!batch.length) return;
      const vectors=await this.embed(batch.map(x=>x.text));
      const update=this.db.prepare('UPDATE chunks SET vector=?,model=? WHERE id=?');
      batch.forEach((x,i)=>update.run(JSON.stringify(vectors[i]),this.model,x.id)); this.job.embedded+=batch.length;
      if(this.job.running)this.progress();
    }
  }
  async search(query: string, projectId?: string, limit=8, semantic=true, timeoutMs=20000) {
    query=cleanMemory(query).slice(0,1000); const terms=query.toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu)?.slice(0,20)??[];
    if(!terms.length) return {mode:'keyword',results:[] as MemoryHit[],warning:''};
    const rows=this.db.prepare(`SELECT c.*,d.title,d.source,d.locator,d.updated_at,d.project_id FROM chunks c JOIN documents d ON d.id=c.document_id ${projectId?'WHERE d.project_id=? OR d.project_id=\'\'':''}`).all(...(projectId?[projectId]:[])) as unknown as Chunk[];
    const ranked=new Map<string,number>();
    const lexical=this.db.prepare(`SELECT chunk_search.id FROM chunk_search JOIN chunks c ON c.id=chunk_search.id JOIN documents d ON d.id=c.document_id WHERE chunk_search MATCH ? ${projectId?"AND (d.project_id=? OR d.project_id='')":''} ORDER BY rank LIMIT 100`).all(terms.map(t=>'"'+t.replaceAll('"','')+'"').join(' OR '),...(projectId?[projectId]:[])) as {id:string}[];
    lexical.forEach((x,i)=>ranked.set(x.id,1/(60+i)));
    let mode='keyword',warning='';
    if(semantic && rows.some(r=>r.vector&&r.model===this.model)) {
      try {
        const [q]=await this.embed([query],true,timeoutMs);
        rows.filter(r=>r.vector&&r.model===this.model).map(r=>{const v=JSON.parse(r.vector!) as number[];return {id:r.id,score:v.length===q.length?v.reduce((s,x,i)=>s+x*q[i],0):-1};}).filter(r=>r.score>0.25).sort((a,b)=>b.score-a.score).slice(0,100).forEach((r,i)=>ranked.set(r.id,(ranked.get(r.id)??0)+1/(60+i)));
        mode='hybrid';
      } catch { warning='Local embeddings unavailable; showing keyword matches.'; }
    } else if(semantic) warning='Build the local neural index to enable semantic retrieval.';
    const seen=new Set<string>();
    const quality=(r:Chunk)=>/\/(?:Build Guide|Context Packet|Overview)\.md$/.test(r.locator)?0.006:0;
    const results=rows.filter(r=>ranked.has(r.id)).sort((a,b)=>(ranked.get(b.id)!+quality(b))-(ranked.get(a.id)!+quality(a))).filter(r=>{const key=r.locator.match(/\/Chats\/([a-f0-9-]{36})\.md$/i)?.[1]??r.document_id;if(seen.has(key))return false;seen.add(key);return true;}).slice(0,limit).map(r=>({id:r.id,documentId:r.document_id,source:r.source,title:r.title,locator:r.locator,excerpt:r.text.slice(0,950),score:ranked.get(r.id)!,updatedAt:r.updated_at,projectId:r.project_id,untrusted:true as const}));
    return {mode,results,warning};
  }
  record(input: {projectId:string;title:string;text:string;evidence:string[]}) {
    if(!input.evidence.length) throw new PublicError('Evidence is required.');
    if(Number(this.db.prepare('SELECT count(*) AS n FROM lessons').get()?.n)>=2000) throw new PublicError('Memory review capacity reached.');
    const id=crypto.randomUUID(); this.db.prepare('INSERT INTO lessons VALUES(?,?,?,?,?,?,?)').run(id,input.projectId,cleanMemory(input.title),cleanMemory(input.text),JSON.stringify(input.evidence.map(cleanMemory)),'pending',new Date().toISOString());
    return {id,status:'pending',searchable:false};
  }
  review(id:string,decision:'approve'|'reject') {
    const lesson=this.db.prepare("SELECT * FROM lessons WHERE id=? AND status='pending'").get(id) as {title:string;text:string;evidence:string;project_id:string;created_at:string}|undefined;
    if(!lesson) throw new PublicError('Pending lesson not found.',404);
    if(decision==='approve')this.upsert({id:'agent:'+id,source:'agent',title:lesson.title,locator:'agent:'+id,text:lesson.text+'\n\nEvidence: '+lesson.evidence,updatedAt:new Date().toISOString(),projectId:lesson.project_id});
    this.db.prepare('UPDATE lessons SET status=? WHERE id=?').run(decision==='approve'?'approved':'rejected',id);
    return {id,status:decision==='approve'?'approved':'rejected'};
  }
  event(id:string,projectId:string,title:string,text:string) {
    this.upsert({id:'agent:event:'+id,source:'agent',title,locator:'event:'+id,text,updatedAt:new Date().toISOString(),projectId});
  }
  startIndex(vault: string) {
    if(this.status().job.running) return this.status();
    this.job={running:true,phase:'reading',processed:0,embedded:0,error:'',completedAt:''};
    void this.index(vault).then(()=>{this.job.phase='complete';this.job.completedAt=new Date().toISOString();}).catch(()=>{this.job.phase='incomplete';this.job.error='Index incomplete. Check the local embedding service/model and source permissions; keyword retrieval remains available.';}).finally(()=>{this.job.running=false;});
    return this.status();
  }
  async index(vault: string) {
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const value=this.db.prepare("SELECT value FROM metadata WHERE key='indexLease'").get()?.value;
      const lease=value?JSON.parse(String(value)) as {until:number}:null;
      if(lease&&lease.until>Date.now())throw new Error('An index operation is already running');
      this.job={running:true,phase:'reading',processed:0,embedded:0,error:'',completedAt:''};this.progress();this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    try{
    const root=await fs.realpath(vault),seen=new Set<string>();
    const walk=async(dir:string)=>{
      for(const item of await fs.readdir(dir,{withFileTypes:true})) {
        if(item.isSymbolicLink()||item.name.startsWith('.'))continue;
        const file=path.join(dir,item.name);const canonical=await fs.realpath(file);
        if(canonical!==root&&!canonical.startsWith(root+path.sep))continue;
        if(item.isDirectory()){await walk(file);continue;}
        if(!item.isFile()||!item.name.toLowerCase().endsWith('.md'))continue;
        const stat=await fs.stat(file);if(stat.size>500000)continue;
        const rel=path.relative(root,file).replaceAll('\\','/'),id='obsidian:'+rel;seen.add(id);
        const content=await fs.readFile(file,'utf8');
        const frontmatter=content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]??'';
        const project=rel.match(/06 Project Context\/Projects\/([^/]+)/)?.[1]??frontmatter.match(/^project: *["']?([a-z0-9-]+)["']? *$/m)?.[1]??'';
        const title=content.match(/^# (.+)$/m)?.[1]?.trim()??path.basename(file,'.md');
        this.upsert({id,source:'obsidian',title,locator:rel,text:content,updatedAt:stat.mtime.toISOString(),projectId:({churchcarehub:'example-care','trading-research':'m5-v15-research'} as Record<string,string>)[project]??project});this.job.processed++;
      }
    };
    await walk(root);
    for(const doc of this.db.prepare("SELECT id FROM documents WHERE source='obsidian'").all() as {id:string}[])if(!seen.has(doc.id))this.db.prepare('DELETE FROM documents WHERE id=?').run(doc.id);
    const snapshotPath=path.join(this.directory,'notion-snapshot.json');
    try {
      const snap=JSON.parse(await fs.readFile(snapshotPath,'utf8')) as {capturedAt:string;complete:boolean;documents:MemoryDocument[]};
      if(!Array.isArray(snap.documents)||snap.documents.length>1000)throw new Error('Invalid Notion snapshot');
      const notionIds=new Set<string>();
      for(const doc of snap.documents){if(doc.source!=='notion'||!/^notion:[a-f0-9-]{32,36}$/i.test(doc.id)||!/^https:\/\/(?:app\.notion\.com|www\.notion\.so)\//.test(doc.locator)||typeof doc.text!=='string')throw new Error('Invalid Notion source');notionIds.add(doc.id);this.upsert(doc);this.job.processed++;}
      if(snap.complete)for(const doc of this.db.prepare("SELECT id FROM documents WHERE source='notion'").all() as {id:string}[])if(!notionIds.has(doc.id))this.db.prepare('DELETE FROM documents WHERE id=?').run(doc.id);
      this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('notionSnapshot',snap.capturedAt);
    }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
    // A cloud outage must not block local learning. Preserve a separate safe diagnostic.
    try{await this.importCloudReports();this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('cloudError','');}catch{this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('cloudError','Cloud report pull unavailable; local sources remain usable.');}
    this.job.phase='embedding';await this.embedPending();
    this.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('lastIndex',new Date().toISOString());
    this.job.phase='complete';this.job.completedAt=new Date().toISOString();
    }catch(e){this.job.phase='incomplete';this.job.error='Index incomplete; check local model and source availability.';throw e;}
    finally{this.job.running=false;this.progress();}
  }
}
let instance:NeuralMemory|undefined;
export async function neuralMemory() {
  const directory=process.env.COMMAND_DECK_DATA_DIR?path.resolve(process.env.COMMAND_DECK_DATA_DIR):path.resolve('data');
  await fs.mkdir(directory,{recursive:true});if(instance?.directory!==directory){instance?.close();instance=new NeuralMemory(directory);}return instance!;
}
export async function memoryContext(query:string,projectId:string) {
  try {const m=await neuralMemory();const r=await augmentedContext(m,query,projectId,'hybrid',1500);return {...r,sources:r.sources.map(x=>({...x,excerpt:x.excerpt.slice(0,600)}))};}catch{return {mode:'unavailable',sources:[],untrusted:true};}
}
export function closeNeuralMemory(){instance?.close();instance=undefined;}
