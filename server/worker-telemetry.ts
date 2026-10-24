import {spawn,execFile,type ChildProcess} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import {loadProjects} from './config.js';
import {harnessEnvironment} from '../mcp/harnesses.js';
import {localRuntime} from './local-runtime.js';
import {trafficVerdict} from './production-watch.js';

/** Frame bounded JSON objects from Wrangler's pretty-printed stream without retaining log lines. */
export class TailFrames {
 private buffer='';private depth=0;private quoted=false;private escape=false;
 push(chunk:string):unknown[]{const results:unknown[]=[];for(const c of chunk){if(!this.depth&&c!=='{')continue;this.buffer+=c;if(this.buffer.length>262144){this.buffer='';this.depth=0;this.quoted=false;this.escape=false;continue;}if(this.quoted){if(this.escape)this.escape=false;else if(c==='\\')this.escape=true;else if(c==='"')this.quoted=false;}else if(c==='"')this.quoted=true;else if(c==='{')this.depth++;else if(c==='}')this.depth--;if(this.depth===0){try{results.push(JSON.parse(this.buffer));}catch{/* incomplete/non-JSON diagnostics */}this.buffer='';}}return results;}
}
export function tailCounts(value:unknown){if(!value||typeof value!=='object')return null;const e=value as {event?:{request?:unknown;response?:{status?:number}};outcome?:string;eventTimestamp?:number};if(!e.event?.request)return null;const status=e.event.response?.status;return {requests:1,errors:typeof status==='number'&&status>=500||Boolean(e.outcome&&e.outcome!=='ok')?1:0,blocked:typeof status==='number'&&[403,429].includes(status)?1:0};}
type Sensor={projectId:string;state:'starting'|'observing'|'unavailable'|'paused';lastEventAt:string|null;detail:string;requests:number;errors:number;blocked:number;child?:ChildProcess};
const sensors=new Map<string,Sensor>();
export function workerTelemetryStatus(){return [...sensors.values()].map(({child,requests,errors,blocked,...rest})=>rest);}
let startPromise:Promise<void>|null=null;
export async function connectWorkerTelemetry(){
 if(startPromise)return startPromise;
 startPromise=(async()=>{
  const projects=await loadProjects();
  for(const id of ['example-planner','example-care']) {
   const previous=sensors.get(id);if(previous?.child&&!previous.child.killed)continue;
   const p=projects.find(p=>p.id===id);const executable=p?.root?path.join(p.root,'node_modules/wrangler/bin/wrangler.js'):'';
   const sensor:Sensor={projectId:id,state:'starting',lastEventAt:null,detail:'Connecting to the registered Worker tail with existing local Wrangler credentials.',requests:0,errors:0,blocked:0};sensors.set(id,sensor);
   if(!executable||!await fs.stat(executable).then(s=>s.isFile(),()=>false)){sensor.state='unavailable';sensor.detail='Install the project’s Wrangler dependency and authenticate Wrangler locally.';continue;}
   const env={...harnessEnvironment(),CI:'true',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false',NO_COLOR:'1'};
   const child=spawn(process.execPath,[executable,'tail',id,'--format','json'],{cwd:p!.root!,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});sensor.child=child;
   const frames=new TailFrames();
   child.stdout.on('data',(chunk:Buffer)=>{for(const value of frames.push(chunk.toString('utf8'))){const count=tailCounts(value);if(!count)continue;sensor.requests+=count.requests;sensor.errors+=count.errors;sensor.blocked+=count.blocked;sensor.state='observing';sensor.lastEventAt=new Date().toISOString();sensor.detail='Observing Worker execution samples. Cached edge hits, WAF blocks and network packets are not covered.';}});
   // Provider diagnostics may contain request/user data; discard them, retain only connection outcome.
   child.stderr.on('data',()=>undefined);
   child.once('error',()=>{sensor.state='unavailable';sensor.detail='Worker tail could not start. Check Wrangler installation and local authentication.';sensor.child=undefined;});
   child.once('exit',()=>{sensor.child=undefined;if(sensor.state==='paused')return;sensor.state='unavailable';sensor.detail='Worker tail stopped or could not authenticate. Check Wrangler permissions and reconnect.';});
   child.unref();
  }
 })().finally(()=>{startPromise=null;});return startPromise;
}
export async function flushWorkerTelemetry(){const r=await localRuntime();for(const sensor of sensors.values()){
 if(sensor.state!=='observing'||!sensor.lastEventAt||Date.now()-Date.parse(sensor.lastEventAt)>300000)continue;
 const input={requests:sensor.requests,errors:sensor.errors,blocked:sensor.blocked,windowSeconds:60};const history=r.observations('traffic',sensor.projectId,30).filter(x=>x.source==='cloudflare-worker-tail');
 r.record('traffic',sensor.projectId,{...input,...trafficVerdict(input,history),source:'cloudflare-worker-tail',coverage:'Worker execution samples only; excludes edge-cache/WAF/network traffic.'});sensor.requests=0;sensor.errors=0;sensor.blocked=0;
}}
export function startWorkerTelemetry(){void localRuntime().then(r=>r.setting('monitoringEnabled','true')==='true'?connectWorkerTelemetry():undefined).catch(()=>undefined);const timer=setInterval(()=>{void (async()=>{const r=await localRuntime();if(r.setting('monitoringEnabled','true')==='true'){await flushWorkerTelemetry();await connectWorkerTelemetry();}else stopWorkerTelemetry();})().catch(()=>undefined);},60000);timer.unref();return ()=>{clearInterval(timer);stopWorkerTelemetry();};}
export function stopWorkerTelemetry(){for(const sensor of sensors.values()){const child=sensor.child;sensor.child=undefined;sensor.state='paused';sensor.detail='Worker sampling paused.';if(child?.pid){if(process.platform==='win32')execFile('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true},()=>undefined);else child.kill();}}}
