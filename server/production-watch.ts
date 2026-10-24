import {z} from 'zod';
import {loadProductionApps} from './config.js';
import {PublicError} from './errors.js';
import {localRuntime,type LocalRuntime} from './local-runtime.js';

export const trafficInput=z.object({projectId:z.string().regex(/^[a-z0-9-]+$/),observedAt:z.string().datetime(),windowSeconds:z.number().int().min(10).max(3600),requests:z.number().int().min(0).max(1e9),errors:z.number().int().min(0).max(1e9),blocked:z.number().int().min(0).max(1e9),source:z.enum(['cloudflare','origin','manual'])}).strict().refine(x=>x.errors<=x.requests&&x.blocked<=x.requests,'Counts cannot exceed total requests.');
export function trafficVerdict(input:{requests:number;errors:number;blocked:number;windowSeconds:number},history:Array<{requests:number;windowSeconds:number}>) {
 const rate=input.requests/input.windowSeconds;
 const baseline=history.length>=5?history.reduce((sum,x)=>sum+x.requests/x.windowSeconds,0)/history.length:null;
 const spike=baseline!==null&&rate>Math.max(20,baseline*5);
 const distress=input.requests>=100&&(input.errors/input.requests>=0.2||input.blocked/input.requests>=0.3);
 return {rate,baseline,status:spike&&distress?'suspected':baseline===null?'learning':'normal',detail:spike&&distress?'Traffic volume and error/block rates exceeded the recent baseline. Investigate upstream telemetry; this is not proof of DDoS.':baseline===null?'Collect at least five earlier aggregate windows to establish a baseline.':'No combined volume-and-distress anomaly in this window.'};
}
export async function ingestTraffic(input:unknown,store?:LocalRuntime){
 const parsed=trafficInput.parse(input);const runtime=store??await localRuntime();
 if(!(await loadProductionApps()).some(x=>x.projectId===parsed.projectId))throw new PublicError('Only registered production projects accept traffic.',404);
 if(Math.abs(Date.now()-Date.parse(parsed.observedAt))>24*60*60_000)throw new PublicError('Traffic window must be within the last 24 hours.');
 const history=runtime.observations('traffic',parsed.projectId,30).filter(x=>x.at<parsed.observedAt&&x.source===parsed.source);
 if(runtime.observations('traffic',parsed.projectId,100).some(x=>x.at===parsed.observedAt&&x.source===parsed.source))return {accepted:false,detail:'This source window was already imported.'};
 const verdict=trafficVerdict(parsed,history);runtime.record('traffic',parsed.projectId,{...parsed,...verdict},parsed.observedAt);return {accepted:true,...verdict};
}
let probing:Promise<unknown>|null=null;
let lastProbe=0;
export async function probeProduction(){
 if(probing)return probing;
 if(Date.now()-lastProbe<30000)throw new PublicError('Production was just checked. Wait 30 seconds before checking again.',429);
 lastProbe=Date.now();probing=(async()=>{
  const runtime=await localRuntime();const apps=await loadProductionApps();
  return Promise.all(apps.map(async app=>{
   const start=Date.now();let status:number|null=null;let error='';
   try {const res=await fetch(app.liveUrl,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(10000)});status=res.status;await res.body?.cancel();}catch{error='Endpoint unavailable or timed out.';}
   const previous=runtime.observations('probes',app.projectId,2);const ok=status!==null&&status>=200&&status<400;
   const consecutiveFailures=ok?0:1+previous.filter((x,i)=>previous.slice(0,i+1).every(y=>y.ok===false)).length;
   const sample={url:app.liveUrl,status,ok,latencyMs:Date.now()-start,error,consecutiveFailures,signal:consecutiveFailures>=3?'availability-alert':ok?'reachable':'check-failed'};
   runtime.record('probes',app.projectId,sample);return {projectId:app.projectId,...sample};
  }));
 })().finally(()=>{probing=null;});return probing;
}
export async function productionWatch(){const r=await localRuntime();return {enabled:r.setting('monitoringEnabled','true')==='true',intervalSeconds:120,coverage:'Availability probes and Worker execution samples/imported aggregates; edge-cache/WAF/network traffic requires provider telemetry.',sensors:(await import('./worker-telemetry.js')).workerTelemetryStatus(),projects:(await loadProductionApps()).map(p=>({id:p.projectId,name:p.name,url:p.liveUrl,probes:r.observations('probes',p.projectId,30),traffic:r.observations('traffic',p.projectId,30)}))};}
export function startProductionWatch(){const run=async()=>{if((await localRuntime()).setting('monitoringEnabled','true')==='true')await probeProduction().catch(()=>undefined);};void run();const timer=setInterval(()=>void run(),120000);timer.unref();return ()=>clearInterval(timer);}
