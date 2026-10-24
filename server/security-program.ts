import {DatabaseSync} from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type express from 'express';
import {securityPractices,securityQueries,securityReferences} from '../shared/security-program.js';
import {detectSecuritySignals,runSyntheticSecurityLabs,type SecurityObservation} from './security-labs.js';
import {PublicError} from './errors.js';
import {cleanMemory} from './neural-memory.js';

const digest=(text:string)=>crypto.createHash('sha256').update(text).digest('hex');
const evidenceReference=(text:string)=>/^sha256:[a-f0-9]{64}$/i.test(text)?text.toLowerCase():cleanMemory(text);
const kinds=['auth_failure','host_rejected','origin_rejected','authorization_denied','rate_limited','validation_failure','change_applied','task_queued','lesson_reviewed','security_evidence_reviewed','lab_run'] as const;
export type SecurityEvent=SecurityObservation&{kind:typeof kinds[number];route:string;sequence:number;previousHash:string;hash:string};
export class SecurityProgramStore {
  db:DatabaseSync;
  constructor(readonly directory:string){
    this.db=new DatabaseSync(path.join(directory,'security-program.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS events(sequence INTEGER PRIMARY KEY AUTOINCREMENT,payload TEXT NOT NULL,previous_hash TEXT NOT NULL,hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lab_runs(id TEXT PRIMARY KEY,at TEXT NOT NULL,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS control_evidence(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,practice_id TEXT NOT NULL,owner TEXT NOT NULL,summary TEXT NOT NULL,reference TEXT NOT NULL,observed_at TEXT NOT NULL,created_at TEXT NOT NULL,status TEXT NOT NULL);`);
    this.db.exec("INSERT OR IGNORE INTO meta(key,value) SELECT 'head',hash FROM events ORDER BY sequence DESC LIMIT 1");
  }
  close(){this.db.close();}
  append(event:Omit<SecurityObservation,'id'|'at'>&{kind:SecurityEvent['kind'];route:string}) {
    if(!kinds.includes(event.kind)||!/^\/[a-z/-]{0,60}$/.test(event.route)||!Number.isInteger(event.status)||event.status<100||event.status>599||!/^[a-z0-9-]{1,100}$/.test(event.projectId)||!/^[a-f0-9-]{36}$/i.test(event.correlationId))throw new Error('Invalid security metadata');
    const payload=JSON.stringify({projectId:event.projectId,kind:event.kind,status:event.status,route:event.route,correlationId:event.correlationId,id:crypto.randomUUID(),at:new Date().toISOString()});
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const previousHash=String(this.db.prepare('SELECT hash FROM events ORDER BY sequence DESC LIMIT 1').get()?.hash??this.db.prepare("SELECT value FROM meta WHERE key='anchor'").get()?.value??'genesis');
      const hash=digest(previousHash+'\n'+payload);const result=this.db.prepare('INSERT INTO events(payload,previous_hash,hash) VALUES(?,?,?)').run(payload,previousHash,hash);
      this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('head',hash);
      const cutoff=Number(result.lastInsertRowid)-10000;
      if(cutoff>0){const anchor=this.db.prepare('SELECT hash FROM events WHERE sequence<=? ORDER BY sequence DESC LIMIT 1').get(cutoff);if(anchor)this.db.prepare('INSERT OR REPLACE INTO meta VALUES(?,?)').run('anchor',String(anchor.hash));this.db.prepare('DELETE FROM events WHERE sequence<=?').run(cutoff);}
      this.db.exec('COMMIT');return result.lastInsertRowid;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  events(limit=100):SecurityEvent[] {return (this.db.prepare('SELECT * FROM events ORDER BY sequence DESC LIMIT ?').all(Math.max(1,Math.min(10000,limit))) as Array<{sequence:number;payload:string;previous_hash:string;hash:string}>).map(r=>({...JSON.parse(r.payload),sequence:r.sequence,previousHash:r.previous_hash,hash:r.hash}));}
  integrity(){
    let previous=String(this.db.prepare("SELECT value FROM meta WHERE key='anchor'").get()?.value??'genesis');let checked=0;
    for(const row of this.db.prepare('SELECT * FROM events ORDER BY sequence').all() as Array<{payload:string;previous_hash:string;hash:string}>){if(row.previous_hash!==previous||digest(previous+'\n'+row.payload)!==row.hash)return {valid:false,checked,scope:'retained-local-chain'};previous=row.hash;checked++;}
    const head=this.db.prepare("SELECT value FROM meta WHERE key='head'").get()?.value;
    return {valid:head===undefined||head===previous,checked,scope:'retained-local-chain'};
  }
  runLabs(){const receipt=runSyntheticSecurityLabs();this.db.prepare('INSERT INTO lab_runs VALUES(?,?,?)').run(receipt.id,receipt.at,JSON.stringify(receipt));this.db.exec('DELETE FROM lab_runs WHERE id NOT IN (SELECT id FROM lab_runs ORDER BY at DESC LIMIT 100)');return receipt;}
  submitEvidence(input:{projectId:string;practiceId:string;owner:string;summary:string;reference:string;observedAt:string}) {
    if(!securityPractices.some(p=>p.id===input.practiceId))throw new PublicError('Unknown security practice.');
    if(!Number.isFinite(Date.parse(input.observedAt))||Date.parse(input.observedAt)>Date.now()+60000||Date.parse(input.observedAt)<Date.now()-30*86400000)throw new PublicError('Evidence must be observed within the last 30 days.');
    if(Number(this.db.prepare('SELECT count(*) n FROM control_evidence').get()?.n)>=2000)throw new PublicError('Security evidence capacity reached. Export and review retained records.');
    const id=crypto.randomUUID();this.db.prepare('INSERT INTO control_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(id,input.projectId,input.practiceId,cleanMemory(input.owner),cleanMemory(input.summary),evidenceReference(input.reference),input.observedAt,new Date().toISOString(),'pending');return {id,status:'pending'};
  }
  reviewEvidence(id:string,decision:'approve'|'reject') {const change=this.db.prepare("UPDATE control_evidence SET status=? WHERE id=? AND status='pending'").run(decision==='approve'?'reviewed':'rejected',id);if(!change.changes)throw new PublicError('Pending evidence not found.',404);return {id,status:decision==='approve'?'reviewed':'rejected'};}
  coverage(projectId:string,now=Date.now()) {
    return securityPractices.map(p=>{const evidence=this.db.prepare("SELECT id,owner,summary,reference,observed_at AS observedAt,created_at AS createdAt,status FROM control_evidence WHERE project_id=? AND practice_id=? AND status='reviewed' ORDER BY created_at DESC,rowid DESC LIMIT 1").get(projectId,p.id) as {id:string;owner:string;summary:string;reference:string;observedAt:string;createdAt:string;status:string}|undefined;return {practiceId:p.id,title:p.title,status:!evidence?'not-assessed':now-Date.parse(evidence.observedAt)>30*86400000?'stale':'reviewed-evidence',evidence:evidence??null};});
  }
  status(projectIds:string[]) {
    const integrity=this.integrity(),recent=integrity.valid?this.events(10000):[];
    return {practices:securityPractices,references:securityReferences,queries:securityQueries,events:recent.slice(0,60),alerts:detectSecuritySignals(recent),integrity,telemetry:{state:journalError||droppedEvents?'degraded':'available',detail:journalError,droppedEvents,retainedLimit:10000,rawRequestBodies:false,externalSiem:'not-configured',endpointEdr:'not-connected'},latestLab:JSON.parse(String(this.db.prepare('SELECT payload FROM lab_runs ORDER BY at DESC LIMIT 1').get()?.payload??'null')),pending:this.db.prepare("SELECT id,project_id AS projectId,practice_id AS practiceId,owner,summary,reference,observed_at AS observedAt FROM control_evidence WHERE status='pending' ORDER BY created_at DESC LIMIT 50").all(),projects:projectIds.map(projectId=>({projectId,controls:this.coverage(projectId)}))};
  }
}
let instance:SecurityProgramStore|undefined;
let opening:Promise<SecurityProgramStore>|undefined;
let journalError='';
let queuedEvents=0,droppedEvents=0;
export async function securityProgramStore() {
  const directory=path.resolve(process.env.COMMAND_DECK_DATA_DIR??'data');
  if(instance?.directory===directory)return instance;
  if(opening)return opening;
  opening=(async()=>{await fs.mkdir(directory,{recursive:true});instance?.close();return instance=new SecurityProgramStore(directory);})();
  try{return await opening;}finally{opening=undefined;}
}
let journal:Promise<unknown>=Promise.resolve();
export function appendSecurityEvent(event:Parameters<SecurityProgramStore['append']>[0]) {if(queuedEvents>=500){droppedEvents++;return journal;}queuedEvents++;journal=journal.then(async()=>{(await securityProgramStore()).append(event);journalError='';}).catch(()=>{journalError='Security metadata collection failed. Check local storage permissions and capacity.';console.warn('Security metadata collection unavailable.');}).finally(()=>{queuedEvents--;});return journal;}
export async function flushSecurityJournal(){await journal;}
export async function closeSecurityProgram(){await journal;instance?.close();instance=undefined;}

/** Allowlisted response metadata only. Runs before guard/auth to observe denied attempts. */
export const securityTelemetry:express.RequestHandler=(req,res,next)=>{
  const correlationId=crypto.randomUUID();res.setHeader('X-Request-ID',correlationId);
  res.once('finish',()=>{
    const status=res.statusCode;let kind:SecurityEvent['kind']|undefined;
    const route=req.path.startsWith('/api/changesets/')?'/api/changesets':req.path.startsWith('/api/memory/')?'/api/memory':req.path.startsWith('/api/security/')?'/api/security':'/api';
    if(res.locals.securityDenial==='host_rejected')kind='host_rejected';else if(res.locals.securityDenial==='origin_rejected')kind='origin_rejected';else if(status===403)kind='authorization_denied';else if(status===401)kind='auth_failure';else if(status===429)kind='rate_limited';else if([400,413,415].includes(status))kind='validation_failure';
    else if(status<300&&req.method==='POST') {
      if(/^\/api\/changesets\/[^/]+\/apply$/.test(req.path))kind='change_applied';
      else if(req.path==='/api/dispatch')kind='task_queued';
      else if(req.path.endsWith('/review')&&req.path.startsWith('/api/memory/'))kind='lesson_reviewed';
      else if(req.path.endsWith('/review')&&req.path.startsWith('/api/security/evidence/'))kind='security_evidence_reviewed';
      else if(req.path==='/api/security/labs')kind='lab_run';
    }
    if(kind)void appendSecurityEvent({kind,route,status,correlationId,projectId:'command-deck'});
  });next();
};

export async function securityBaselineGate(projectId:string) {
  const store=await securityProgramStore(),controls=store.coverage(projectId);const covered=controls.filter(c=>c.status==='reviewed-evidence').length;
  const integrity=store.integrity();
  return {id:'security-operations' as const,label:'Security operations baseline',status:!integrity.valid?'action-needed' as const:covered===securityPractices.length?'pass' as const:'not-run' as const,detail:`${covered}/${securityPractices.length} practices have current owner-reviewed evidence. This is an evidence review gate, not a certification. Synthetic labs do not satisfy production controls.`};
}
