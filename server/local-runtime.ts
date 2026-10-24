import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PublicError } from './errors.js';
import { cleanMemory } from './neural-memory.js';

export type LocalJob = { id:string; sessionId:string|null; tool:string; projectId:string; status:'queued'|'running'|'complete'|'failed'|'interrupted'; createdAt:string; updatedAt:string; result:unknown; error:string;ownerPid?:number;phase?:string };
export type ChatMessage = { id:string; role:'user'|'assistant'; text:string; at:string; routing?:{mode:'local'|'deepseek';durationMs:number}; sources?:unknown[]; jobs?:string[] };

/** One durable journal shared by standalone tools and the local assistant. */
export class LocalRuntime {
 readonly db:DatabaseSync;
 readonly active=new Set<string>();
 constructor(readonly directory:string) {
  this.db=new DatabaseSync(path.join(directory,'local-assistant.sqlite'));
  this.db.exec(`PRAGMA journal_mode=WAL;
   CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,project_id TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS probes(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS traffic(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,at TEXT NOT NULL,payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  for(const row of this.db.prepare('SELECT payload FROM jobs').all() as {payload:string}[]) {
   const job=JSON.parse(row.payload) as LocalJob;
   let ownerAlive=false;if(job.ownerPid){try{process.kill(job.ownerPid,0);ownerAlive=true;}catch(error){ownerAlive=(error as NodeJS.ErrnoException).code==='EPERM';}}
   if(['queued','running'].includes(job.status)&&!ownerAlive)this.saveJob({...job,status:'interrupted',error:'The service restarted. Review any remote run before retrying.',updatedAt:new Date().toISOString()});
  }
 }
 close(){this.db.close();}
 sessions(){return this.db.prepare('SELECT id,title,project_id AS projectId,updated_at AS updatedAt FROM sessions ORDER BY updated_at DESC LIMIT 50').all();}
 setSessionProject(id:string,projectId:string){this.session(id);this.db.prepare('UPDATE sessions SET project_id=?,updated_at=? WHERE id=?').run(projectId,new Date().toISOString(),id);}
 createSession(projectId:string,title='New conversation') {
  const id=crypto.randomUUID();this.db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(id,cleanMemory(title).slice(0,100),projectId,new Date().toISOString());return this.session(id);
 }
 session(id:string) {
  const row=this.db.prepare('SELECT id,title,project_id AS projectId,updated_at AS updatedAt FROM sessions WHERE id=?').get(id) as {id:string;title:string;projectId:string;updatedAt:string}|undefined;
  if(!row)throw new PublicError('Conversation not found.',404);
  return {...row,messages:(this.db.prepare('SELECT payload FROM messages WHERE session_id=? ORDER BY rowid DESC LIMIT 100').all(id) as {payload:string}[]).reverse().map(x=>JSON.parse(x.payload) as ChatMessage)};
 }
 message(sessionId:string,message:Omit<ChatMessage,'id'|'at'>) {
  this.session(sessionId);const item={...message,text:cleanMemory(message.text).slice(0,16000),id:crypto.randomUUID(),at:new Date().toISOString()};
  this.db.prepare('INSERT INTO messages VALUES(?,?,?)').run(item.id,sessionId,JSON.stringify(item));this.db.prepare('UPDATE sessions SET updated_at=? WHERE id=?').run(item.at,sessionId);return item;
 }
 jobs(){return (this.db.prepare('SELECT payload FROM jobs ORDER BY rowid DESC LIMIT 60').all() as {payload:string}[]).map(x=>JSON.parse(x.payload) as LocalJob);}
 job(id:string){const row=this.db.prepare('SELECT payload FROM jobs WHERE id=?').get(id);if(!row)throw new PublicError('Task not found.',404);return JSON.parse(String(row.payload)) as LocalJob;}
 saveJob(job:LocalJob){this.db.prepare('INSERT OR REPLACE INTO jobs VALUES(?,?)').run(job.id,JSON.stringify(job));}
 enqueue(tool:string,projectId:string,run:(report:(phase:string)=>void)=>Promise<unknown>,sessionId:string|null=null,id=crypto.randomUUID()) {
  if(this.active.size>=3)throw new PublicError('Three local tasks are already running. Wait for one to finish.',429);
  const job:LocalJob={id,sessionId,tool,projectId,ownerPid:process.pid,status:'queued',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),result:null,error:''};this.saveJob(job);this.active.add(job.id);
  void (async()=>{
   job.status='running';job.updatedAt=new Date().toISOString();this.saveJob(job);
   try {job.result=await run(phase=>{job.phase=phase.slice(0,160);job.updatedAt=new Date().toISOString();this.saveJob(job);});job.status='complete';}
   catch(error){job.status='failed';job.error=error instanceof PublicError?error.message:'The local tool could not complete. Check its setup and retry.';}
   finally {job.updatedAt=new Date().toISOString();this.saveJob(job);this.active.delete(job.id);void import('./system-tools.js').then(m=>m.exportTaskReceipt(job)).catch(()=>{this.setSetting('receiptExportError','A task receipt could not be saved to the vault. Check vault access.');});}
  })();return {...job};
 }
 setting(key:string,fallback:string){return String(this.db.prepare('SELECT value FROM settings WHERE key=?').get(key)?.value??fallback);}
 setSetting(key:string,value:string){this.db.prepare('INSERT OR REPLACE INTO settings VALUES(?,?)').run(key,value);}
 record(kind:'probes'|'traffic',projectId:string,payload:Record<string,unknown>,at=new Date().toISOString()) {
  this.db.prepare(`INSERT INTO ${kind} VALUES(?,?,?,?)`).run(crypto.randomUUID(),projectId,at,JSON.stringify(payload));
  this.db.prepare(`DELETE FROM ${kind} WHERE rowid NOT IN (SELECT rowid FROM ${kind} ORDER BY rowid DESC LIMIT 5000)`).run();
 }
 observations(kind:'probes'|'traffic',projectId:string,limit=60) {return (this.db.prepare(`SELECT at,payload FROM ${kind} WHERE project_id=? ORDER BY at DESC LIMIT ?`).all(projectId,limit) as {at:string;payload:string}[]).map(x=>({at:x.at,...JSON.parse(x.payload)}));}
}
let runtime:LocalRuntime|undefined;
let opening:Promise<LocalRuntime>|undefined;
export async function localRuntime(){const directory=path.resolve(process.env.COMMAND_DECK_DATA_DIR??'data');if(runtime?.directory===directory)return runtime;if(opening)return opening;opening=(async()=>{runtime?.close();await fs.mkdir(directory,{recursive:true});runtime=new LocalRuntime(directory);return runtime;})().finally(()=>{opening=undefined;});return opening;}
export function closeLocalRuntime(){runtime?.close();runtime=undefined;}
