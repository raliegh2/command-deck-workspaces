import crypto from 'node:crypto';
import { securityPractices } from '../shared/security-program.js';
import { cleanMemory } from './neural-memory.js';

export type SecurityObservation={id:string;at:string;projectId:string;kind:string;status:number;correlationId:string};
export function normalizeTimeline(events:SecurityObservation[],now=Date.now()) {
  const rejected=events.filter(e=>!Number.isFinite(Date.parse(e.at))||Date.parse(e.at)>now+60000);
  const valid=events.filter(e=>!rejected.includes(e));
  return {events:[...new Map(valid.map(e=>[e.id,{...e,at:new Date(e.at).toISOString()}])).values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||a.id.localeCompare(b.id)),rejected:rejected.map(e=>e.id)};
}
export function detectSecuritySignals(events:SecurityObservation[],now=Date.now()) {
  const recent=normalizeTimeline(events,now).events.filter(e=>Date.parse(e.at)>=now-60000&&Date.parse(e.at)<=now);
  const alerts:Array<{id:string;projectId:string;severity:'high'|'medium';technique:string|null;reason:string;evidence:string[]}>=[];
  for(const projectId of new Set(recent.map(e=>e.projectId))) {
    const auth=recent.filter(e=>e.projectId===projectId&&e.kind==='auth_failure');
    const boundary=recent.filter(e=>e.projectId===projectId&&['host_rejected','origin_rejected'].includes(e.kind));
    if(auth.length>=5)alerts.push({id:'auth-burst:'+projectId,projectId,severity:'high',technique:'T1110',reason:'At least five denied authentications in 60 seconds; aggregate suspicion, not confirmed compromise.',evidence:auth.map(e=>e.id)});
    if(boundary.length>=3)alerts.push({id:'boundary-burst:'+projectId,projectId,severity:'medium',technique:null,reason:'Repeated local trust-boundary rejections in 60 seconds.',evidence:boundary.map(e=>e.id)});
  }
  return alerts;
}
export type ProcessEvidence={parent:string;image:string;signed:boolean;encoded:boolean};
export function suspiciousProcess(p:ProcessEvidence,exception?:{parent:string;image:string;expiresAt:number},now=Date.now()) {
  const exact=exception&&exception.expiresAt>now&&p.signed&&exception.parent===p.parent&&exception.image===p.image;
  return !exact&&/^(winword|excel|outlook)\.exe$/i.test(p.parent)&&/^(powershell|pwsh|cmd)\.exe$/i.test(p.image)&&p.encoded;
}
export function phishingReasons(e:{from:string;reply:string;spf:boolean;dkim:boolean;dmarc:boolean}) {
  const reasons:string[]=[];if(e.from.toLowerCase()!==e.reply.toLowerCase())reasons.push('reply-domain-mismatch');if(!e.spf&&!e.dkim&&!e.dmarc)reasons.push('sender-authentication-failed');return reasons;
}
export function staticTriage(bytes:Uint8Array,name:string) {return {sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length,typeMismatch:bytes[0]===0x4d&&bytes[1]===0x5a&&!/\.(exe|dll)$/i.test(name),verdict:'unknown' as const};}
export function enrichIndicator(indicator:string,records:Array<{indicator:string;reputation:string;source:string;expiresAt:number}>,now=Date.now()) {const match=records.find(r=>r.indicator===indicator&&r.expiresAt>now&&r.source);return match?{status:'recorded',reputation:match.reputation,source:match.source}:{status:'unknown',reputation:null,source:null};}
export function validHandoff(value:{projectId:string;owner:string;severity:string;evidence:string[];nextAction:string}) {return Boolean(value.projectId&&value.owner.trim()&&['high','medium','low','critical'].includes(value.severity)&&value.evidence.length&&value.evidence.every(x=>x.trim())&&value.nextAction.trim());}
export function soarPlan(alerts:Array<{id:string;evidence:string[]}>) {return {mode:'dry-run' as const,cases:[...new Map(alerts.map(a=>[a.id,{id:a.id,evidence:a.evidence,actions:['preserve-metadata','prepare-handoff'],productionMutationAllowed:false}])).values()]};}

/** Deterministic, inert fixtures. No URL fetching, processes, EDR actions or malware execution. */
export function runSyntheticSecurityLabs(now=Date.now()) {
  const event=(id:string,offset:number,kind='auth_failure'):SecurityObservation=>({id,at:new Date(now+offset).toISOString(),projectId:'synthetic-only',kind,status:kind==='auth_failure'?401:200,correlationId:'fixture-'+id});
  const positive=Array.from({length:5},(_,i)=>event('denied-'+i,-i*1000)),negative=[event('benign',-100,'request_ok')];
  const alerts=detectSecuritySignals([...positive,...negative],now),benign=detectSecuritySignals(negative,now);
  const process={parent:'winword.exe',image:'powershell.exe',signed:true,encoded:true};
  const exception={parent:process.parent,image:process.image,expiresAt:now+60000};
  const timeline=normalizeTimeline([event('late',-1000),{...event('invalid',0),at:'invalid'},event('early',-5000),event('future',120000)],now);
  const report=cleanMemory('Synthetic lesson: password=example-secret-value must never appear in a handoff.');
  const handoff={projectId:'synthetic-only',owner:'exercise-responder',severity:'high',evidence:alerts.flatMap(a=>a.evidence),nextAction:'Review evidence; request approval before containment.'};
  const records=[{indicator:'known.invalid',reputation:'suspicious',source:'offline-fixture',expiresAt:now+1000},{indicator:'expired.invalid',reputation:'suspicious',source:'offline-fixture',expiresAt:now-1}];
  const specimen=Buffer.from('MZ inert synthetic fixture; not an executable file.');
  const checks:Record<string,Array<{name:string;passed:boolean}>>={
    'alert-triage':[{name:'Positive burst yields one high alert',passed:alerts.length===1&&alerts[0].severity==='high'},{name:'Benign request is not an incident',passed:benign.length===0}],
    'log-analysis':[{name:'Invalid timestamp is quarantined',passed:timeline.rejected.includes('invalid')},{name:'Timezone normalizes to UTC',passed:normalizeTimeline([{...event('offset',0),at:new Date(now).toISOString().replace('Z','+00:00')}],now).events[0].at===new Date(now).toISOString()}],
    'siem-queries':[{name:'Local equivalent meets the five-event threshold',passed:alerts[0]?.evidence.length===5},{name:'Below-threshold window remains quiet',passed:detectSecuritySignals(positive.slice(0,4),now).length===0}],
    'edr-investigation':[{name:'Suspicious Office-to-shell ancestry is detected',passed:suspiciousProcess(process)},{name:'Ordinary application process stays benign',passed:!suspiciousProcess({...process,parent:'explorer.exe',encoded:false})}],
    'phishing-analysis':[{name:'Two independent suspicious metadata signals',passed:phishingReasons({from:'sender.invalid',reply:'other.invalid',spf:false,dkim:false,dmarc:false}).length===2},{name:'Matching authenticated sender stays benign',passed:phishingReasons({from:'sender.invalid',reply:'sender.invalid',spf:true,dkim:true,dmarc:true}).length===0}],
    'malware-triage':[{name:'Inert bytes produce a reproducible identity and type mismatch',passed:staticTriage(specimen,'sample.txt').sha256===crypto.createHash('sha256').update(specimen).digest('hex')&&staticTriage(specimen,'sample.txt').typeMismatch&&staticTriage(specimen,'sample.txt').verdict==='unknown'}],
    'ioc-enrichment':[{name:'Fresh known indicator retains source',passed:enrichIndicator('known.invalid',records,now).source==='offline-fixture'},{name:'Unknown and expired indicators stay unknown',passed:enrichIndicator('absent.invalid',records,now).status==='unknown'&&enrichIndicator('expired.invalid',records,now).status==='unknown'}],
    'detection-tuning':[{name:'Exact signed current exception suppresses the baseline',passed:!suspiciousProcess(process,exception,now)},{name:'Expired or unsigned exceptions do not suppress',passed:suspiciousProcess(process,{...exception,expiresAt:now-1},now)&&suspiciousProcess({...process,signed:false},exception,now)}],
    'attack-mapping':[{name:'Observed authentication rule maps narrowly to T1110',passed:alerts[0]?.technique==='T1110'},{name:'Interpreter evidence supports its distinct technique scenario',passed:suspiciousProcess(process)}],
    'forensic-timelines':[{name:'Out-of-order events become deterministic UTC order',passed:timeline.events.map(e=>e.id).join(',')==='early,late'},{name:'Future clock skew remains explicit',passed:timeline.rejected.includes('future')}],
    'escalation-handoff':[{name:'Complete handoff is usable',passed:validHandoff(handoff)},{name:'Missing owner or evidence is rejected',passed:!validHandoff({...handoff,owner:''})&&!validHandoff({...handoff,evidence:[]})}],
    'soar-automation':[{name:'Repeated alerts produce one case plan',passed:soarPlan([...alerts,...alerts]).cases.length===1},{name:'Containment is never authorized by this plan',passed:soarPlan(alerts).cases.every(c=>!c.productionMutationAllowed)}],
    'reporting-lessons':[{name:'Credential value is absent from the prepared report',passed:!report.includes('example-secret-value')},{name:'Reporting does not confer containment authority',passed:!soarPlan(alerts).cases[0].productionMutationAllowed}],
    'purple-team':[{name:'Compound detection, timeline and handoff chain succeeds',passed:alerts.length===1&&suspiciousProcess(process)&&timeline.events.length===2&&validHandoff(handoff)&&benign.length===0}],
  };
  return {id:crypto.randomUUID(),at:new Date(now).toISOString(),scope:'synthetic-only' as const,networkAccess:false,processExecution:false,productionChanges:false,externalSiemValidated:false,results:securityPractices.map(p=>({practiceId:p.id,title:p.title,passed:checks[p.id].every(c=>c.passed),checks:checks[p.id]}))};
}
