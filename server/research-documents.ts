import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import type {Express} from 'express';
import {localRuntime} from './local-runtime.js';
import {runSystemTool} from './system-tools.js';
import {researchRun,researchHelper,type ResearchRun} from './research-workspace.js';
import {publicUrl} from './public-web.js';
import {cleanMemory} from './neural-memory.js';
import {PublicError} from './errors.js';

export const briefSchema=z.object({title:z.string().trim().max(160).default(''),kind:z.enum(['report','brief','lesson-plan','study-guide','comparison']).default('report'),audience:z.string().trim().max(160).default('General reader'),purpose:z.string().trim().max(1000).default(''),theme:z.enum(['editorial','navy','forest']).default('editorial'),headings:z.array(z.string().trim().min(1).max(80)).max(8).default([])}).strict();
export type Brief=z.infer<typeof briefSchema>;
type Section={heading:string;paragraphs:{text:string;sourceIds:string[]}[]};
export type DocumentContent={title:string;subtitle:string;kind:Brief['kind'];theme:Brief['theme'];audience:string;purpose:string;createdAt:string;sections:Section[];sources:{id:string;title:string;url:string;at:string}[];notes:string[]};
type Session={id:string;title:string;brief:Brief;messages:{role:'user'|'assistant';text:string;at:string}[];runId?:string;jobId?:string;document?:DocumentContent;revision:number;files:string[]};
const folder=(id:string)=>path.resolve(process.env.COMMAND_DECK_DATA_DIR??'data','research-documents',id);
async function runtime(){const r=await localRuntime();r.db.exec('CREATE TABLE IF NOT EXISTS research_document_sessions(id TEXT PRIMARY KEY,payload TEXT NOT NULL)');return r;}
async function save(session:Session){session.messages=session.messages.slice(-30);(await runtime()).db.prepare('INSERT OR REPLACE INTO research_document_sessions VALUES(?,?)').run(session.id,JSON.stringify(session));}
export async function documentSession(id:string){z.string().uuid().parse(id);const row=(await runtime()).db.prepare('SELECT payload FROM research_document_sessions WHERE id=?').get(id);if(!row)throw new PublicError('Research conversation not found.',404);return JSON.parse(String(row.payload)) as Session;}
export function interpretDocumentRequest(message:string,previous?:Brief,overrides:Partial<Brief>={}){
 const urls=[...new Set((message.match(/https?:\/\/[^\s<>"']+/g)??[]).map(s=>publicUrl(s.replace(/[),.;]+$/,'')).href))].slice(0,8);
 const brief=briefSchema.parse({...previous,...overrides});
 const choices:[RegExp,Brief['kind']][]=[[/lesson\s*plan/i,'lesson-plan'],[/study\s*guide|revision\s*guide/i,'study-guide'],[/compar(?:e|ison)|side.by.side/i,'comparison'],[/brief(?:ing)?|one.page|executive summary/i,'brief'],[/report/i,'report']];
 for(const [pattern,kind] of choices)if(pattern.test(message)){brief.kind=kind;break;}
 const audience=message.match(/(?:for|aimed at)\s+((?:grade|year)\s*\d+[^.\n]{0,60}|children[^.\n]{0,60}|students[^.\n]{0,60}|teachers[^.\n]{0,60}|staff[^.\n]{0,60}|executives[^.\n]{0,60})/i);if(audience)brief.audience=audience[1].replace(/\s+in (?:a |an )?(?:navy|blue|green|forest|orange|editorial).*$/i,'').trim();
 {if(/navy|blue theme/i.test(message))brief.theme='navy';if(/green|forest/i.test(message))brief.theme='forest';if(/orange|editorial/i.test(message))brief.theme='editorial';}
 if(previous&&(brief.kind!==previous.kind||brief.audience!==previous.audience)&&(!overrides.purpose||overrides.purpose===previous.purpose))brief.purpose='Prepare a '+brief.kind.replaceAll('-',' ')+' for '+brief.audience+' using the collected sources.';
 if(!brief.purpose)brief.purpose=message.replace(/https?:\/\/[^\s]+/g,'').trim().slice(0,1000)||'Create a source-backed document from these pages.';
 return {brief,urls,query:message.replace(/https?:\/\/[^\s]+/g,'').replace(/^(?:please\s+)?(?:find|research|collect|create|write|make)\s+/i,'').slice(0,250).trim()};
}
export function composeDocument(run:ResearchRun,brief:Brief):DocumentContent{
 const sources=run.sources.filter(s=>s.status==='collected'&&s.text?.trim());if(!sources.length)throw new PublicError('No readable pages were collected. '+run.sources.map(s=>s.host+': '+(s.reason??s.status)).slice(0,4).join(' ')+' Try another public URL.',422);
 const keywords=new Set((brief.purpose+' '+run.prompt).toLowerCase().match(/[a-z]{4,}/g)??[]);
 const findings=sources.flatMap(source=>{const lines=(source.text??'').split(/\n+/).map(t=>t.trim()).filter(t=>t.length>=65&&t.length<=1800&&!/^(?:cookie|privacy policy|sign in|all rights reserved|these are some|learn more|find out|notice:|the following pages|you can learn)/i.test(t));const ranked=[...new Set(lines)].map((text,index)=>({text,index,score:[...keywords].filter(w=>text.toLowerCase().includes(w)).length})).sort((a,b)=>b.score-a.score||a.index-b.index);return ranked.slice(0,3).map(item=>({text:item.text.split(/\s+/).slice(0,70).join(' ')+(item.text.split(/\s+/).length>70?'…':''),sourceIds:[source.id]}));});
 const sections:Section[]=[];const topic=(sources[0].title??run.prompt).replace(/\s*\|.*$/,'').replace(/^About\s+/i,'').replace(/[™®]/g,'').trim();const young=/(?:grade|year)\s*[1-6]\b|children/i.test(brief.audience);const first=findings[0];
 if(brief.kind==='lesson-plan'){
  sections.push({heading:'Learning focus',paragraphs:[{text:'By the end of this lesson, '+brief.audience+' learners will explain one key idea about '+topic+', identify two supporting details in the reading, and name the source that supports their explanation.',sourceIds:[]}]},{heading:'Source-backed teaching material',paragraphs:findings},{heading:'Suggested learning sequence',paragraphs:[
   {text:'Connect · 5 minutes: display the title “'+topic+'”. Ask: “What do we already know? What would we like to find out?” Record questions to revisit at the end.',sourceIds:[]},
   {text:'Read together · 10 minutes: '+(young?'read each extract aloud, pause to explain unfamiliar words, and let pairs draw or describe its main idea.':'annotate each extract and discuss the difference between a main idea and supporting evidence.'),sourceIds:sources.map(s=>s.id)},
   {text:'Investigate · 10 minutes: use this evidence: “'+(first?.text??'')+'” Ask: “What does this tell us about '+topic+'? Which words support your answer?”',sourceIds:first?.sourceIds??[]},
   {text:'Apply · 15 minutes: '+(young?'make a four-box poster titled “'+topic+'”: one main idea, two facts from the extracts, a labeled drawing, and the source name.':'write a short explanation of '+topic+' with two cited supporting details and one question the reading leaves unanswered.'),sourceIds:[]},
   {text:'Check understanding · 5 minutes: complete “One thing I learned about '+topic+' is ___. My evidence is ___. It comes from ___.” Assess the accuracy of the idea, the match between evidence and claim, and the named source.',sourceIds:[]}
  ]});
 }else if(brief.kind==='study-guide')sections.push({heading:'Essential reading',paragraphs:findings},{heading:'Study prompts',paragraphs:sources.map(s=>({text:'Summarize the main idea of “'+(s.title??s.host)+'”. Record one supporting fact and explain why it matters for your purpose.',sourceIds:[s.id]}))},{heading:'Check your understanding',paragraphs:[{text:'Compare the sources, identify any disagreement or missing information, and write a short evidence-backed answer to your original question.',sourceIds:[]}]});
 else if(brief.kind==='comparison')for(const source of sources)sections.push({heading:source.title??source.host,paragraphs:findings.filter(f=>f.sourceIds.includes(source.id))});
 else sections.push({heading:brief.kind==='brief'?'Key points':'Findings from the web',paragraphs:findings});
 if(brief.headings.length){const items=sections.flatMap(s=>s.paragraphs.filter(p=>p.sourceIds.length));sections.splice(0,sections.length,...brief.headings.map((heading,i)=>({heading,paragraphs:items.filter((_,n)=>n%brief.headings.length===i)})));}
 return {title:brief.title||sources[0].title||run.prompt.slice(0,100),subtitle:brief.kind.replaceAll('-',' '),kind:brief.kind,theme:brief.theme,audience:brief.audience,purpose:brief.purpose,createdAt:new Date().toISOString(),sections,sources:sources.map(s=>({id:s.id,title:s.title??s.host,url:s.url,at:s.at})),notes:[...run.warnings,'Findings are attributed extracts from collected pages. Teaching activities and study prompts are suggested structure, not claims made by the sources.','Review the collected evidence before distributing the document.']};
}
export function registerResearchDocuments(app:Express){
 app.get('/api/local/research/documents',async(_req,res)=>res.json({sessions:((await runtime()).db.prepare('SELECT payload FROM research_document_sessions ORDER BY rowid DESC LIMIT 30').all() as {payload:string}[]).map(row=>{const s=JSON.parse(row.payload) as Session;return {id:s.id,title:s.title,revision:s.revision};})}));
 app.get('/api/local/research/documents/:id',async(req,res)=>res.json(await documentSession(req.params.id)));
 app.post('/api/local/research/documents',async(req,res)=>{
  const input=z.object({sessionId:z.string().uuid().optional(),message:z.string().trim().min(2).max(2000),brief:briefSchema.partial().optional(),reuseSources:z.boolean().default(true),maxPages:z.number().int().min(1).max(12).default(4)}).strict().parse(req.body);
  if(cleanMemory(input.message)!==input.message)throw new PublicError('Remove private identifiers and credentials before researching public sources.',400);
  const r=await runtime();let session:Session=input.sessionId?await documentSession(input.sessionId):{id:crypto.randomUUID(),title:input.message.slice(0,90),brief:briefSchema.parse({}),messages:[],revision:0,files:[]};
  if(session.jobId&&['queued','running'].includes(r.job(session.jobId).status))throw new PublicError('This document is still being created. Wait for the current step to finish.',409);
  const parsed=interpretDocumentRequest(input.message,session.brief,input.brief);session.brief=parsed.brief;
  session.messages.push({role:'user',text:input.message,at:new Date().toISOString()});
  if(/^(?:hi|hello|hey)[!.\s]*$/i.test(input.message)){session.messages.push({role:'assistant',text:'Send a public URL or describe a topic. Tell me who the document is for and choose a report, briefing, lesson plan, study guide or comparison.',at:new Date().toISOString()});await save(session);res.json({session});return;}
  if(r.active.size>=3)throw new PublicError('Three local tasks are already running. Retry after one finishes.',429);
  const reuse=Boolean(input.reuseSources&&session.runId&&!parsed.urls.length),jobId=crypto.randomUUID();session.jobId=jobId;await save(session);
  const job=r.enqueue('research.document','command-deck',async report=>{
   try{
    let run:ResearchRun;if(reuse){report('Reading your collected sources');run=await researchRun(session.runId!);}else{report(parsed.urls.length?'Opening and reading the supplied pages':'Finding and reading public sources');const result=await runSystemTool('research.collect',{prompt:input.message.slice(0,1500),urls:parsed.urls,queries:parsed.urls.length?[]:[parsed.query.length>=2?parsed.query:input.message.slice(0,250)],fields:['title','url','description'],maxPages:input.maxPages,maxDepth:0,modelExtraction:false}) as {id:string};run=await researchRun(result.id);session.runId=run.id;}
    report('Organizing the source material for your document');session.document=composeDocument(run,session.brief);session.title=session.document.title;session.revision++;
    report('Designing Word, PDF and web editions');const target=folder(session.id);await fs.mkdir(target,{recursive:true});await fs.writeFile(path.join(target,'document.json'),JSON.stringify(session.document,null,2));const generated=await researchHelper(['document',target]);session.files=generated.files;session.messages.push({role:'assistant',text:`${reuse?'Reused':'Read'} ${session.document.sources.length} ${session.document.sources.length===1?'source':'sources'} and created your ${session.brief.kind.replaceAll('-',' ')} for ${session.brief.audience}. Review the document and download an edition, or tell me what to change.`,at:new Date().toISOString()});await save(session);return {sessionId:session.id,sources:session.document.sources.length,revision:session.revision};
   }catch(error){session.messages.push({role:'assistant',text:error instanceof PublicError?error.message:'The document could not be completed. Collected sources remain available; retry with another public URL or inspect collection notes.',at:new Date().toISOString()});await save(session);throw error;}
  },null,jobId);res.status(202).json({session,job});
 });
 app.get('/api/local/research/documents/:id/files/:file',async(req,res)=>{const session=await documentSession(req.params.id),name=req.params.file;if(!['document.docx','document.pdf','document.html','document.md','document.json'].includes(name)||!session.files.includes(name))throw new PublicError('Document file not found.',404);res.download(path.join(folder(session.id),name),session.title.replace(/[^\w -]/g,'').slice(0,80)+path.extname(name));});
}
