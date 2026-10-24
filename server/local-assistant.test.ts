import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {LocalRuntime} from './local-runtime.js';
import {trafficVerdict,trafficInput} from './production-watch.js';
import {parseLocalPlan} from './local-chat.js';
import {TailFrames,tailCounts} from './worker-telemetry.js';

let temp='';let runtime:LocalRuntime|undefined;
afterEach(async()=>{runtime?.close();runtime=undefined;if(temp)await fs.rm(temp,{recursive:true,force:true});temp='';});
describe('durable local execution',()=>{
 it('does not interrupt a task owned by a live local process during inspection',async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'deck-owner-'));runtime=new LocalRuntime(temp);runtime.saveJob({id:'owned',ownerPid:process.pid,sessionId:null,tool:'system.backup',projectId:'command-deck',status:'running',createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),result:null,error:''});runtime.close();runtime=new LocalRuntime(temp);expect(runtime.job('owned').status).toBe('running');
 });
 it('persists conversations and marks interrupted tasks for review on restart',async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'deck-chat-'));runtime=new LocalRuntime(temp);const session=runtime.createSession('command-deck');runtime.message(String(session.id),{role:'user',text:'Inspect the project'});
  runtime.saveJob({id:'pending',sessionId:String(session.id),tool:'northstar.build',projectId:'northstar',status:'running',createdAt:'2026-10-21T00:00:00Z',updatedAt:'2026-10-21T00:00:00Z',result:null,error:''});
  runtime.close();runtime=new LocalRuntime(temp);expect(runtime.session(String(session.id)).messages[0].text).toBe('Inspect the project');expect(runtime.job('pending').status).toBe('interrupted');
 });
 it('records failed execution rather than claiming completion',async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'deck-job-'));runtime=new LocalRuntime(temp);const job=runtime.enqueue('test','command-deck',async()=>{throw new Error('private-secret');});
  await vi.waitFor(()=>expect(runtime!.job(job.id).status).toBe('failed'));expect(runtime.job(job.id).error).not.toContain('private-secret');
 });
 it('bounds concurrent work',async()=>{
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'deck-limit-'));runtime=new LocalRuntime(temp);const releases:Array<()=>void>=[];
  for(let i=0;i<3;i++)runtime.enqueue('test','command-deck',()=>new Promise(resolve=>releases.push(()=>resolve({ok:true}))));
  expect(()=>runtime!.enqueue('test','command-deck',async()=>null)).toThrow('Three local tasks');releases.forEach(fn=>fn());await vi.waitFor(()=>expect(runtime!.active.size).toBe(0));
 });
});
describe('tool plan boundaries',()=>{
 it('does not repeat identical model actions',()=>expect(parseLocalPlan(JSON.stringify({answer:'Check readiness',actions:[{tool:'system.health',input:{}},{tool:'system.health',input:{}}]})).actions).toHaveLength(1));
 it('rejects unknown execution capabilities before running any action',()=>expect(()=>parseLocalPlan('{"answer":"go","actions":[{"tool":"shell","input":{"command":"anything"}}]}')).toThrow('unavailable tool'));
 it('rejects malformed or oversized plans',()=>{expect(()=>parseLocalPlan('not JSON')).toThrow('valid action plan');expect(()=>parseLocalPlan(JSON.stringify({answer:'go',actions:Array.from({length:4},()=>({tool:'monitor.status',input:{}}))}))).toThrow();});
 it('accepts a registered non-destructive action plan',()=>expect(parseLocalPlan('{"answer":"Inspect current coverage","actions":[{"tool":"monitor.status","input":{}}]}').actions).toHaveLength(1));
});
describe('production aggregate anomaly coverage',()=>{
 const history=Array.from({length:5},()=>({requests:600,windowSeconds:60}));
 it('does not call an ordinary traffic spike a DDoS attack',()=>expect(trafficVerdict({requests:10000,errors:0,blocked:0,windowSeconds:60},history).status).toBe('normal'));
 it('flags combined volume and distress for investigation',()=>expect(trafficVerdict({requests:10000,errors:4000,blocked:0,windowSeconds:60},history).status).toBe('suspected'));
 it('reports learning without baseline evidence and validates totals',()=>{expect(trafficVerdict({requests:10000,errors:4000,blocked:0,windowSeconds:60},[]).status).toBe('learning');expect(()=>trafficInput.parse({projectId:'test',observedAt:'2026-10-21T00:00:00Z',windowSeconds:60,requests:1,errors:2,blocked:0,source:'origin'})).toThrow();});
});
describe('Worker telemetry minimization',()=>{
 it('frames split JSON events and retains counts only',()=>{const frames=new TailFrames();expect(frames.push('diagnostic\n{"event":{"request":')).toEqual([]);const values=frames.push('{"url":"https://private.example/?secret=x"},"response":{"status":503}},"outcome":"ok"}\n');expect(values).toHaveLength(1);expect(tailCounts(values[0])).toEqual({requests:1,errors:1,blocked:0});expect(JSON.stringify(tailCounts(values[0]))).not.toContain('private');});
 it('ignores unrelated console events and handles braces inside strings',()=>{expect(tailCounts({logs:['private']})).toBeNull();const frames=new TailFrames();expect(frames.push('{"log":"{not a brace}\\\""}\n{"ok":true}')).toHaveLength(2);});
});
