import fs from 'node:fs/promises';
import path from 'node:path';
import {localRuntime,type LocalJob} from './local-runtime.js';
import {submitChat} from './local-chat.js';
import {redactSensitiveText} from './privacy.js';
import {projectById} from './projects.js';

type Config={url:string;token:string;enabled:boolean};
type RemoteTask={id:string;kind:'ask'|'task';project_id:string;prompt:string;claim_token:string};
type Journal={task:RemoteTask;sessionId?:string;jobId?:string;state:'starting'|'submitted'|'receipted'};
export const remoteTools=['research.collect','research.plan','research.runs','research.read','northstar.build','northstar.runs','audit.web','audit.report','audit.functional','monitor.probe','monitor.status','project.inspect'] as const;
let timer:ReturnType<typeof setInterval>|undefined,busy=false,lastError='',lastConnected='',discordReady=false;
async function config():Promise<Config|null>{
 const runtime=await localRuntime();
 const input=await fs.readFile(path.join(runtime.directory,'cloud-discord','private.json'),'utf8').catch(()=>null);
 if(!input)return null;
 try{const c=JSON.parse(input) as Config;const url=new URL(c.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.workers.dev')||url.username||url.password||url.search||url.hash||url.pathname!=='/'||typeof c.token!=='string'||c.token.length<48)return null;return {...c,url:url.origin};}catch{return null;}
}
async function call(c:Config,route:string,body:unknown){
 const r=await fetch(c.url+route,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
 if(!r.ok){await r.body?.cancel();if(route==='/relay/complete'&&r.status===409)return {ok:false,expired:true};throw Error('Cloud relay request failed.');}return r.json() as Promise<Record<string,any>>;
}
function publicReceipt(job:LocalJob){
 const answer=(job.result as {answer?:unknown}|null)?.answer;
 const source=job.status==='complete'&&typeof answer==='string'?answer:job.error||'Local task interrupted. Review locally before resubmitting.';
 return redactSensitiveText(source).replace(/\b(?:ghp_|github_pat_|sk-)[A-Za-z0-9_-]{15,}/g,'[redacted-secret]').slice(0,1800);
}
/** Durable per-task journal prevents re-executing accepted work after crashes. */
export async function cloudDiscordTick(){
 if(busy)return;busy=true;
 try{
  const c=await config();if(!c)return;
  const runtime=await localRuntime();
  runtime.db.exec('CREATE TABLE IF NOT EXISTS cloud_discord_jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');
  const heartbeat=await call(c,'/relay/heartbeat',{});discordReady=heartbeat.discordConfigured===true;lastConnected=new Date().toISOString();lastError='';
  const rows=runtime.db.prepare('SELECT id,payload FROM cloud_discord_jobs').all() as {id:string;payload:string}[];
  for(const row of rows){
   const journal=JSON.parse(row.payload) as Journal;if(journal.state==='receipted')continue;
   let job:LocalJob|undefined;
   if(journal.jobId){try{job=runtime.job(journal.jobId);}catch{/* Fail closed, never replay missing journal work. */}}
   if(job&&['queued','running'].includes(job.status)){
    await call(c,'/relay/heartbeat',{id:row.id,claimToken:journal.task.claim_token});return;
   }
   await call(c,'/relay/complete',{id:row.id,claimToken:journal.task.claim_token,status:job?.status==='complete'?'complete':job?.status==='failed'?'failed':'interrupted',result:job?publicReceipt(job):'Local execution journal was interrupted. Review locally before resubmitting.'});
   runtime.db.prepare('UPDATE cloud_discord_jobs SET payload=? WHERE id=?').run(JSON.stringify({state:'receipted',task:{id:row.id},jobId:journal.jobId,sessionId:journal.sessionId}),row.id);
   return;
  }
  if(!c.enabled||runtime.active.size)return;
  const claimed=await call(c,'/relay/claim',{});const task=claimed.task as RemoteTask|null;if(!task)return;
  if(!/^task_\d{17,22}$/.test(task.id)||!['ask','task'].includes(task.kind)||typeof task.prompt!=='string'||task.prompt.length>1200||typeof task.claim_token!=='string'||!await projectById(task.project_id)){
   if(/^task_\d{17,22}$/.test(task.id))await call(c,'/relay/complete',{id:task.id,claimToken:task.claim_token,status:'failed',result:'The requested project or task is unavailable in this local installation.'});return;
  }
  if(runtime.db.prepare('SELECT id FROM cloud_discord_jobs WHERE id=?').get(task.id))return;
  const journal:Journal={task,state:'starting'};
  runtime.db.prepare('INSERT INTO cloud_discord_jobs VALUES(?,?)').run(task.id,JSON.stringify(journal));
  const session=runtime.createSession(task.project_id,'Discord '+task.id);journal.sessionId=session.id;
  const job=await submitChat(session.id,task.prompt,{questionOnly:task.kind==='ask',allowedTools:remoteTools});
  journal.jobId=job.id;journal.state='submitted';
  runtime.db.prepare('UPDATE cloud_discord_jobs SET payload=? WHERE id=?').run(JSON.stringify(journal),task.id);
 }catch{lastError='Cloud relay unavailable or a receipt needs reconciliation. Pending work is retained; no automatic replay.';}
 finally{busy=false;}
}
export async function cloudDiscordStatus(){const c=await config();return {configured:Boolean(c),enabled:Boolean(c?.enabled),url:c?.url??'',discordReady,lastConnected,lastError,mode:'outbound-only',paidAI:false,remoteTools:[...remoteTools],note:'Cloud receives requests while this PC is off. Local execution requires Command Deck running; interrupted tasks are never automatically replayed.'};}
export async function setCloudDiscordEnabled(enabled:boolean){const c=await config();if(!c)throw Error('Cloud relay must be configured first.');const runtime=await localRuntime();const file=path.join(runtime.directory,'cloud-discord','private.json');const temp=file+'.tmp';await fs.writeFile(temp,JSON.stringify({...c,enabled}),{mode:0o600});await fs.rename(temp,file);return cloudDiscordStatus();}
export function startCloudDiscord(){if(timer)return;void cloudDiscordTick();timer=setInterval(()=>void cloudDiscordTick(),30000);timer.unref();}
export function stopCloudDiscord(){if(timer)clearInterval(timer);timer=undefined;}
