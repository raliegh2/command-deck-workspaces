import {afterEach,describe,expect,it} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {SecurityProgramStore} from './security-program.js';
import {detectSecuritySignals,normalizeTimeline,runSyntheticSecurityLabs,suspiciousProcess,enrichIndicator} from './security-labs.js';
const stores:SecurityProgramStore[]=[];
afterEach(async()=>{for(const s of stores.splice(0)){s.close();await fs.rm(s.directory,{recursive:true,force:true});}});
async function setup(){const s=new SecurityProgramStore(await fs.mkdtemp(path.join(os.tmpdir(),'deck-security-')));stores.push(s);return s;}
const observation=(id:string,projectId='northstar',at=new Date().toISOString())=>({id,projectId,at,kind:'auth_failure',status:401,correlationId:crypto.randomUUID()});
describe('security operations',()=>{
  it('correlates only fresh project-scoped events and deduplicates repeated event IDs',()=>{
    const now=Date.now(),five=Array.from({length:5},(_,i)=>observation(String(i),'northstar',new Date(now-1000).toISOString()));
    expect(detectSecuritySignals([...five,...five],now)[0].evidence).toHaveLength(5);
    expect(detectSecuritySignals([...five.slice(0,4),observation('other','other')],now)).toEqual([]);
    expect(detectSecuritySignals(five.map(e=>({...e,at:new Date(now-61000).toISOString()})),now)).toEqual([]);
    expect(normalizeTimeline([{...five[0],at:'invalid'},five[1],{...five[2],at:new Date(now+120000).toISOString()}],now).rejected).toHaveLength(2);
  });
  it('detects retained event modification and retains correlation without request content',async()=>{
    const s=await setup();s.append({projectId:'command-deck',kind:'auth_failure',status:401,route:'/api',correlationId:crypto.randomUUID()});
    expect(s.integrity()).toMatchObject({valid:true,checked:1});expect(s.events()[0]).toMatchObject({kind:'auth_failure',status:401});
    const other=await setup();other.append({projectId:'command-deck',kind:'auth_failure',status:401,route:'/api',correlationId:crypto.randomUUID()});other.db.exec('DELETE FROM events');expect(other.integrity().valid).toBe(false);
    s.db.prepare("UPDATE events SET payload=replace(payload,'auth_failure','request_ok')").run();expect(s.integrity().valid).toBe(false);
    expect(()=>s.append({projectId:'command-deck',kind:'auth_failure',status:401,route:'/api?token=secret',correlationId:crypto.randomUUID()})).toThrow('Invalid security metadata');
  });
  it('keeps a bounded retained chain with a deletion anchor',async()=>{
    const s=await setup();let previous='genesis';s.db.exec('BEGIN');
    for(let i=0;i<10001;i++){const payload=JSON.stringify(observation(String(i))),hash=crypto.createHash('sha256').update(previous+'\n'+payload).digest('hex');s.db.prepare('INSERT INTO events(payload,previous_hash,hash) VALUES(?,?,?)').run(payload,previous,hash);previous=hash;}s.db.exec('COMMIT');
    s.append({projectId:'command-deck',kind:'lab_run',status:200,route:'/api/security',correlationId:crypto.randomUUID()});expect(s.integrity()).toMatchObject({valid:true,checked:10000});
  });
  it('keeps pending/rejected evidence outside coverage and expires reviewed claims',async()=>{
    const s=await setup(),input={projectId:'northstar',practiceId:'log-analysis',owner:'Security responder',summary:'Reviewed normalized telemetry and the retained evidence receipt.',reference:'commit:0123456789abcdef',observedAt:new Date().toISOString()};
    const first=s.submitEvidence(input);expect(s.coverage('northstar').find(c=>c.practiceId==='log-analysis')?.status).toBe('not-assessed');s.reviewEvidence(first.id,'reject');expect(s.coverage('northstar').some(c=>c.status==='reviewed-evidence')).toBe(false);
    const second=s.submitEvidence(input);s.reviewEvidence(second.id,'approve');expect(s.coverage('northstar').find(c=>c.practiceId==='log-analysis')?.status).toBe('reviewed-evidence');expect(s.coverage('other').some(c=>c.status==='reviewed-evidence')).toBe(false);
    expect(s.coverage('northstar',Date.now()+31*86400000).find(c=>c.practiceId==='log-analysis')?.status).toBe('stale');expect(()=>s.reviewEvidence(second.id,'approve')).toThrow();
    expect(()=>s.submitEvidence({...input,observedAt:new Date(Date.now()+120000).toISOString()})).toThrow('30 days');
    const third=s.submitEvidence({...input,reference:'sha256:'+'a'.repeat(64)});s.reviewEvidence(third.id,'approve');expect(s.coverage('northstar').find(c=>c.practiceId==='log-analysis')?.evidence?.reference).toBe('sha256:'+'a'.repeat(64));
  });
  it('runs all 14 inert exercises without satisfying any production evidence',async()=>{
    const s=await setup(),receipt=s.runLabs();expect(receipt.results).toHaveLength(14);expect(receipt.results.filter(r=>!r.passed)).toEqual([]);expect(receipt).toMatchObject({scope:'synthetic-only',networkAccess:false,processExecution:false,productionChanges:false,externalSiemValidated:false});
    expect(s.events()).toEqual([]);expect(s.coverage('northstar').every(c=>c.status==='not-assessed')).toBe(true);
  });
  it('bounds exceptions and reputation freshness instead of suppressing unknown evidence',()=>{
    const now=Date.now(),p={parent:'winword.exe',image:'powershell.exe',signed:true,encoded:true};
    expect(suspiciousProcess(p,{parent:p.parent,image:p.image,expiresAt:now+1000},now)).toBe(false);
    expect(suspiciousProcess({...p,signed:false},{parent:p.parent,image:p.image,expiresAt:now+1000},now)).toBe(true);
    expect(enrichIndicator('unknown.invalid',[],now).status).toBe('unknown');expect(runSyntheticSecurityLabs(now).results.every(r=>r.passed)).toBe(true);
  });
});
