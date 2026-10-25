import {brandFont} from './brand-font.js';
import express, {type Express} from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {z} from 'zod';
import {localRuntime} from './local-runtime.js';
import {runSystemTool,serviceLinks} from './system-tools.js';
import {PublicError} from './errors.js';
import {dataDir,getState,setWorkStatus} from './store.js';
import {vaultRoot} from './knowledge.js';

type Upload={id:string;name:string;filename:string;size:number;createdAt:string;jobId?:string};
const idSchema=z.string().uuid();
export function validateUpload(name:string,bytes:Buffer){
 const ext=path.extname(name).toLowerCase();
 if(!['.pdf','.docx','.pptx','.png','.jpg','.jpeg'].includes(ext))throw new PublicError('Choose a PDF, Word, PowerPoint, PNG or JPEG document.',400);
 if(!bytes.length||bytes.length>20000000)throw new PublicError('Choose a nonempty document smaller than 20 MB.',400);
 const valid=ext==='.pdf'?bytes.subarray(0,5).toString()==='%PDF-':ext==='.png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):ext==='.jpg'||ext==='.jpeg'?bytes[0]===255&&bytes[1]===216:bytes[0]===80&&bytes[1]===75;
 if(!valid)throw new PublicError('The document contents do not match its file type.',400);
 return ext;
}
export function documentText(markdown:string){return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/,'').trim();}
async function uploads(){const r=await localRuntime();return JSON.parse(r.setting('workspace:uploads','[]')) as Upload[];}
async function saveUploads(items:Upload[]){(await localRuntime()).setSetting('workspace:uploads',JSON.stringify(items));}
async function view(item:Upload){
 const job=item.jobId?(await localRuntime()).job(item.jobId):null;
 const hash=(job?.result as {hash?:string}|null)?.hash;
 let content='',approved=false;if(hash&&/^[a-f0-9]{64}$/.test(hash)){
  const review=path.join(dataDir,'system','document-review',hash+'.md');
  content=documentText(await fs.readFile(review,'utf8').catch(()=>fs.readFile(path.join(vaultRoot,'04 Sources','Document Imports',hash+'.md'),'utf8').then(text=>{approved=true;return text;}).catch(()=>'')));
 }
 return {id:item.id,name:item.name,size:item.size,createdAt:item.createdAt,job,status:job?.status??'uploaded',content,hash,approved};
}
export function registerWorkspaceApi(app:Express){
 app.get('/brand-font.ttf',(_req,res)=>{res.setHeader('Cache-Control','public, max-age=31536000, immutable');res.type('font/ttf').send(Buffer.from(brandFont,'base64'));});
 app.post('/api/workspace/search',async(req,res)=>{
  const {query}=z.object({query:z.string().trim().min(2).max(300)}).strict().parse(req.body);
  const result=await runSystemTool('system.search',{query}) as {results:{url:string;title:string;excerpt:string}[]};
  result.results=result.results.filter(row=>{try{const u=new URL(row.url);return ['http:','https:'].includes(u.protocol)&&!u.username&&!u.password;}catch{return false;}});
  res.json(result);
 });
 app.get('/api/workspace/overview',async(_req,res)=>{
  const services=await Promise.all(serviceLinks.map(async s=>{try{const response=await fetch(s.check,{redirect:'error',signal:AbortSignal.timeout(1500)});await response.body?.cancel();return {id:s.id,name:s.name,ready:response.ok};}catch{return {id:s.id,name:s.name,ready:false};}}));
  const state=getState();res.json({services,jobs:(await localRuntime()).jobs(),pendingChanges:state.changesets.filter(c=>c.status==='pending').length});
 });
 app.patch('/api/workspace/tasks/:id',async(req,res)=>{const {status}=z.object({status:z.enum(['queued','in-progress','review-pending','blocked','complete'])}).strict().parse(req.body);res.json(await setWorkStatus(req.params.id,status));});
 app.get('/api/workspace/documents',async(_req,res)=>res.json({documents:await Promise.all((await uploads()).map(view))}));
 app.post('/api/workspace/documents',express.raw({type:'application/octet-stream',limit:20000000}),async(req,res)=>{
  const name=z.string().min(1).max(180).parse(req.query.name);
  if(!Buffer.isBuffer(req.body))throw new PublicError('Upload the document file.',400);
  const ext=validateUpload(name,req.body),id=crypto.randomUUID(),filename='upload-'+id+ext;
  const folder=path.join(dataDir,'document-inbox');await fs.mkdir(folder,{recursive:true});await fs.writeFile(path.join(folder,filename),req.body,{flag:'wx'});
  const item={id,name:path.basename(name.replaceAll('\\','/')),filename,size:req.body.length,createdAt:new Date().toISOString()};
  const items=await uploads();items.unshift(item);await saveUploads(items);res.status(201).json(await view(item));
 });
 app.post('/api/workspace/documents/:id/process',async(req,res)=>{
  const id=idSchema.parse(req.params.id),items=await uploads(),item=items.find(i=>i.id===id);if(!item)throw new PublicError('Document not found.',404);
  const runtime=await localRuntime();if(item.jobId&&['queued','running','complete'].includes(runtime.job(item.jobId).status)){res.json(await view(item));return;}
  const job=runtime.enqueue('system.ingest','command-deck',()=>runSystemTool('system.ingest',{filename:item.filename}));item.jobId=job.id;await saveUploads(items);res.status(202).json(await view(item));
 });
}
