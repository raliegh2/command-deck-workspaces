import {afterEach,describe,expect,it,vi} from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {NeuralMemory} from './neural-memory.js';
import {answerFromMemory,augmentedContext,contextPack} from './augmented-memory.js';
const stores:NeuralMemory[]=[];
afterEach(async()=>{for(const m of stores.splice(0)){m.close();await fs.rm(m.directory,{recursive:true,force:true});}});
async function setup(fetcher:typeof fetch=fetch){const m=new NeuralMemory(await fs.mkdtemp(path.join(os.tmpdir(),'deck-cag-')),fetcher);stores.push(m);return m;}
function seed(m:NeuralMemory,id='guide',projectId='command-deck',text='Recovery uses the reviewed backup.') {m.upsert({id,source:'obsidian',title:'Recovery guide',text,projectId,locator:'Projects/'+projectId+'/Overview.md',updatedAt:'2026-10-19T00:00:00Z'});}
describe('RAG and CAG',()=>{
  it('persists project packs, invalidates edits/deletions, expires and isolates projects',async()=>{
    const m=await setup();seed(m);seed(m,'other','northstar');const first=contextPack(m,'command-deck',1000000);
    expect(first.cache.hit).toBe(false);expect(first.sources.map(s=>s.documentId)).toEqual(['guide']);expect(contextPack(m,'command-deck',1000001).cache.hit).toBe(true);
    expect(contextPack(m,'command-deck',1900000).cache.hit).toBe(false);
    seed(m,'guide','command-deck','Changed recovery procedure');expect(contextPack(m,'command-deck',1900001).cache.fingerprint).not.toBe(first.cache.fingerprint);
    m.db.prepare('DELETE FROM documents WHERE id=?').run('guide');expect(contextPack(m,'command-deck',1900002).sources).toEqual([]);
  });
  it('excludes pending lessons and includes them after approval',async()=>{
    const m=await setup();const lesson=m.record({projectId:'command-deck',title:'Reviewed lesson',text:'Use the recorded recovery procedure.',evidence:['run:42']});expect(contextPack(m,'command-deck').sources).toEqual([]);
    m.review(lesson.id,'approve');expect(contextPack(m,'command-deck').sources[0].source).toBe('agent');
  });
  it('runs CAG without query retrieval and RAG without a context pack',async()=>{
    const m=await setup();seed(m);const spy=vi.spyOn(m,'search');const cag=await augmentedContext(m,'unrelated','command-deck','cag');expect(spy).not.toHaveBeenCalled();expect(cag.cache).not.toBeNull();
    const rag=await augmentedContext(m,'Recovery','command-deck','rag');expect(spy).toHaveBeenCalledOnce();expect(rag.cache).toBeNull();expect(rag.sources[0].label).toBe('S1');
  });
  it('generates only on loopback with bounded options and validated source labels',async()=>{
    const fetcher=vi.fn(async(url:unknown,init?:RequestInit)=>{expect(url).toBe('http://127.0.0.1:11434/api/generate');const b=JSON.parse(String(init?.body));expect(b.options.num_predict).toBe(1536);expect(b.prompt).toContain('[S1]');return Response.json({done:true,done_reason:'stop',response:JSON.stringify({answer:'Use the reviewed backup. [S1]',citations:['S1']}),prompt_eval_cached_count:32});});
    const m=await setup(fetcher as typeof fetch);seed(m);const result=await answerFromMemory(m,'How to recover?','command-deck','cag');expect(result.abstained).toBe(false);expect(result.citations).toEqual(['S1']);expect(result.runtimeCachedTokens).toBe(32);
  });
  it('abstains without evidence, on invalid citations, truncated generation and offline runtime',async()=>{
    const fetcher=vi.fn(async()=>Response.json({done:true,response:JSON.stringify({answer:'Unsupported answer [S99]',citations:['S99']})}));const m=await setup(fetcher as typeof fetch);
    expect((await answerFromMemory(m,'Recover?','command-deck','cag')).abstained).toBe(true);expect(fetcher).not.toHaveBeenCalled();seed(m);
    expect((await answerFromMemory(m,'Recover?','command-deck','cag')).abstained).toBe(true);
    fetcher.mockImplementation(async()=>Response.json({done:true,done_reason:'length',response:JSON.stringify({answer:'Partial [S1]',citations:['S1']})}));expect((await answerFromMemory(m,'Recover?','command-deck','cag')).abstained).toBe(true);
    fetcher.mockImplementation(async()=>{throw new Error('offline');});expect((await answerFromMemory(m,'Recover?','command-deck','cag')).sources).toHaveLength(1);
    expect(m.db.prepare("SELECT value FROM metadata WHERE key='localGenerationLease'").get()).toBeUndefined();
  });
  it('rejects overlapping inference and answers whose source changed during generation',async()=>{
    const m=await setup(async()=>{seed(m,'guide','command-deck','New evidence');return Response.json({done:true,response:JSON.stringify({answer:'Old backup [S1]',citations:['S1']})});});seed(m);
    expect((await answerFromMemory(m,'Recover?','command-deck','cag')).abstained).toBe(true);
    m.db.prepare('INSERT OR REPLACE INTO metadata VALUES(?,?)').run('localGenerationLease',JSON.stringify({owner:'another-client',until:Date.now()+10000}));
    await expect(answerFromMemory(m,'Recover?','command-deck','cag')).rejects.toThrow('busy');
  });
});
