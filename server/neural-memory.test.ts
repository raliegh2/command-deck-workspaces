import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {NeuralMemory,type MemoryDocument} from './neural-memory.js';
const dirs:string[]=[],stores:NeuralMemory[]=[];
afterEach(async()=>{stores.splice(0).forEach(m=>m.close());for(const p of dirs.splice(0))await fs.rm(p,{recursive:true,force:true});});
async function setup(fetcher:typeof fetch=fetch){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'deck-memory-'));dirs.push(dir);const m=new NeuralMemory(dir,fetcher);stores.push(m);return m;}
const doc=(id:string,text:string,projectId='command-deck'):MemoryDocument=>({id,source:'obsidian',title:id,locator:id+'.md',text,projectId,updatedAt:'2026-10-19T00:00:00.000Z'});
describe('private neural memory',()=>{
  it('quarantines agent claims until reviewed and preserves evidence',async()=>{
    const m=await setup();const lesson=m.record({projectId:'command-deck',title:'Rollback procedure',text:'Restore the previous revision and reconcile records.',evidence:['run 42; reviewed revision abc']});
    expect((await m.search('reconcile',undefined,8,false)).results).toEqual([]);
    m.review(lesson.id,'approve');const hits=(await m.search('reconcile',undefined,8,false)).results;
    expect(hits[0]).toMatchObject({source:'agent',projectId:'command-deck',untrusted:true});expect(hits[0].excerpt).toContain('run 42');
    expect(()=>m.review(lesson.id,'approve')).toThrow('Pending lesson not found');
  });
  it('redacts credentials and separates projects',async()=>{
    const m=await setup();m.upsert(doc('one','Recovery password=super-secret-value alice@example.com ghp_abcdefghijklmnopqrst','northstar'));m.upsert(doc('two','Recovery for a lesson plan','example-planner'));
    const r=await m.search('Recovery','northstar',8,false);expect(r.results).toHaveLength(1);expect(r.results[0].excerpt).not.toContain('super-secret-value');expect(r.results[0].excerpt).not.toContain('alice@example.com');expect(r.results[0].excerpt).not.toContain('ghp_');
  });
  it('uses semantic matches without shared words and persists embeddings',async()=>{
    const mock=vi.fn(async(_url:unknown,init?:RequestInit)=>{const b=JSON.parse(String(init?.body));return Response.json({embeddings:b.input.map(()=>[1,0,0])});});
    const m=await setup(mock as typeof fetch);m.upsert(doc('backup','Database snapshots protect stored information.'));await m.embedPending();expect((await m.search('restore records')).mode).toBe('hybrid');expect((await m.search('restore records')).results[0].documentId).toBe('backup');
    expect(m.upsert(doc('backup','Database snapshots protect stored information.'))).toBe(false);expect(m.status().embedded).toBe(1);
    m.close();stores.splice(stores.indexOf(m),1);const reopened=new NeuralMemory(m.directory,mock as typeof fetch);stores.push(reopened);expect(reopened.status().embedded).toBe(1);
  });
  it('falls back to lexical evidence when the neural service fails',async()=>{
    const m=await setup(async()=>{throw new Error('offline');});m.upsert(doc('backups','Verified backups support recovery.'));m.db.prepare('UPDATE chunks SET vector=?,model=?').run('[1,0]',m.model);const r=await m.search('backups');expect(r.mode).toBe('keyword');expect(r.results).toHaveLength(1);expect(r.warning).toContain('unavailable');
  });
  it('reuses embeddings for metadata edits and prevents concurrent index processes',async()=>{
    const m=await setup();m.upsert(doc('one','Shared recovery evidence'));m.db.prepare('UPDATE chunks SET vector=?,model=?').run('[1,0]',m.model);
    m.upsert({...doc('one','Shared recovery evidence'),title:'Clearer source title'});expect(m.status().embedded).toBe(1);
    m.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('indexLease',JSON.stringify({owner:'another-process',until:Date.now()+60000,job:{running:true,phase:'embedding',processed:1,embedded:0,error:'',completedAt:''}}));
    expect(m.status().job.running).toBe(true);await expect(m.index(m.directory)).rejects.toThrow('already running');
  });
  it('deduplicates shared source conversations across project folders',async()=>{
    const m=await setup(),id='01a10dbb-84e1-7eb2-88ea-3dab4987a3b7';
    m.upsert({...doc('one','Recovery source evidence'),locator:'Projects/a/Chats/'+id+'.md'});m.upsert({...doc('two','Recovery source evidence'),locator:'Projects/b/Chats/'+id+'.md'});
    expect((await m.search('Recovery',undefined,8,false)).results).toHaveLength(1);
  });
  it('pulls cloud-agent reports once and rejects credential destinations outside the owned service',async()=>{
    const fetcher=vi.fn(async()=>Response.json({reports:[{id:'12345678-1234-4123-8123-123456789012',sequence:1,title:'Cloud operation',markdown:'The observed endpoint recovered.',createdAt:'2026-10-19T12:00:00.000Z',projectId:'command-deck'}],hasMore:false}));
    const m=await setup(fetcher as typeof fetch),config=path.join(m.directory,'cloud-memory.json'),credentialFile=path.join(m.directory,'test-credential.json');
    await fs.writeFile(credentialFile,JSON.stringify({OPS_ADMIN_TOKEN:'test-only-'.padEnd(40,'x')}));await fs.writeFile(config,JSON.stringify({url:'https://evil.example',credentialFile}));await expect(m.importCloudReports()).rejects.toThrow('Invalid cloud');expect(fetcher).not.toHaveBeenCalled();
    await fs.writeFile(config,JSON.stringify({url:'https://command-deck-cloud-agents.vercel.app',credentialFile}));await m.importCloudReports();expect(m.status().cloud.cursor).toBe(1);expect((await m.search('endpoint',undefined,8,false)).results[0].source).toBe('cloud');
    expect(fetcher.mock.calls).toHaveLength(1);expect(m.status().sources).toContainEqual(expect.objectContaining({source:'cloud',documents:1}));
  });
  it('incrementally removes deleted notes and excludes hidden folders and links',async()=>{
    const mock=async(_url:unknown,init?:RequestInit)=>Response.json({embeddings:JSON.parse(String(init?.body)).input.map(()=>[1,0])});
    const m=await setup(mock as typeof fetch),vault=path.join(m.directory,'vault');await fs.mkdir(path.join(vault,'.obsidian'),{recursive:true});await fs.writeFile(path.join(vault,'note.md'),'---\nproject: command-deck\n---\nDatabase recovery evidence');await fs.writeFile(path.join(vault,'.obsidian','hidden.md'),'hidden');
    await m.index(vault);expect(m.db.prepare('SELECT project_id FROM documents').get()?.project_id).toBe('command-deck');expect(m.status().chunks).toBe(1);await fs.unlink(path.join(vault,'note.md'));await m.index(vault);expect(m.status().chunks).toBe(0);
  });
});
