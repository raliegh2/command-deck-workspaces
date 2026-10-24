import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const mocked=vi.hoisted(()=>({submit:vi.fn()}));
vi.mock('./local-chat.js',()=>({submitChat:mocked.submit}));
import {cloudDiscordTick} from './cloud-discord.js';
import {localRuntime,closeLocalRuntime,type LocalJob} from './local-runtime.js';
let directory='',calls:Array<{route:string;body:any}>=[],claims=0,conflict=false;
const task={id:'task_123456789012345678',kind:'task',project_id:'command-deck',prompt:'Create a synthetic brief',claim_token:'test-claim'};
async function enabled(value:boolean){await fs.writeFile(path.join(directory,'cloud-discord','private.json'),JSON.stringify({url:'https://test.example.workers.dev',token:'synthetic-only-'.repeat(5),enabled:value}));}
function job(sessionId:string,status:LocalJob['status']='complete'):LocalJob{return {id:'local-test-job',sessionId,tool:'assistant',projectId:'command-deck',status,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),result:{answer:'Synthetic receipt'},error:'',ownerPid:process.pid};}
beforeEach(async()=>{
 directory=await fs.mkdtemp(path.join(os.tmpdir(),'deck-cloud-relay-'));vi.stubEnv('COMMAND_DECK_DATA_DIR',directory);await fs.mkdir(path.join(directory,'cloud-discord'));await enabled(true);calls=[];claims=0;conflict=false;mocked.submit.mockReset();
 vi.stubGlobal('fetch',vi.fn(async(url:string,options:RequestInit)=>{const route=new URL(url).pathname,body=JSON.parse(String(options.body));calls.push({route,body});if(route==='/relay/claim')return Response.json({task:claims++===0?task:null});if(route==='/relay/complete'&&conflict)return Response.json({ok:false},{status:409});return Response.json({ok:true,discordConfigured:false});}));
 mocked.submit.mockImplementation(async(sessionId:string)=>{const j=job(sessionId);(await localRuntime()).saveJob(j);return j;});
});
afterEach(async()=>{closeLocalRuntime();vi.unstubAllGlobals();vi.unstubAllEnvs();await fs.rm(directory,{recursive:true,force:true});});
it('persists accepted work and never executes it twice across runtime reopen',async()=>{
 await cloudDiscordTick();closeLocalRuntime();await cloudDiscordTick();await cloudDiscordTick();expect(mocked.submit).toHaveBeenCalledTimes(1);expect(calls.filter(c=>c.route==='/relay/complete')).toHaveLength(1);const r=await localRuntime();const row=r.db.prepare('SELECT payload FROM cloud_discord_jobs').get() as {payload:string};expect(row.payload).not.toContain(task.prompt);expect(row.payload).not.toContain(task.claim_token);
});
it('reports an interrupted starting journal instead of repeating a failed submission',async()=>{
 mocked.submit.mockRejectedValue(Error('synthetic failure'));await cloudDiscordTick();await cloudDiscordTick();expect(mocked.submit).toHaveBeenCalledTimes(1);expect(calls.find(c=>c.route==='/relay/complete')?.body.status).toBe('interrupted');
});
it('pausing prevents new claims while retaining heartbeats and receipts for running work',async()=>{
 mocked.submit.mockImplementation(async(sessionId:string)=>{const j=job(sessionId,'running');(await localRuntime()).saveJob(j);return j;});await cloudDiscordTick();await enabled(false);calls=[];await cloudDiscordTick();expect(calls.some(c=>c.route==='/relay/claim')).toBe(false);expect(calls.some(c=>c.body.claimToken===task.claim_token)).toBe(true);const r=await localRuntime();r.saveJob({...r.job('local-test-job'),status:'complete'});await cloudDiscordTick();expect(calls.some(c=>c.route==='/relay/complete')).toBe(true);
});
it('reconciles rejected late receipts without poisoning future queue polls',async()=>{
 await cloudDiscordTick();conflict=true;await cloudDiscordTick();await cloudDiscordTick();expect(mocked.submit).toHaveBeenCalledTimes(1);expect(calls.filter(c=>c.route==='/relay/claim')).toHaveLength(2);expect(calls.filter(c=>c.route==='/relay/complete')).toHaveLength(1);
});

