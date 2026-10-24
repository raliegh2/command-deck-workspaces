import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {PublicError} from './errors.js';
import {harnessEnvironment} from '../mcp/harnesses.js';

export type HarnessReply={text:string;metadata:Record<string,unknown>};
let connection:Promise<Client>|undefined;
let transport:StdioClientTransport|undefined;
async function connect() {
 const root=process.env.COMMAND_DECK_DEEPSEEK_PLUGIN??path.resolve('integrations/deepseek');
 const script=path.join(root,'scripts/deepseek_mcp.py');
 if(!await fs.stat(script).then(x=>x.isFile(),()=>false))throw new PublicError('DeepSeek MCP harness is not installed. Set COMMAND_DECK_DEEPSEEK_PLUGIN to its local plugin directory.',503);
 const bundled=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
 const python=process.env.COMMAND_DECK_PYTHON??(process.platform==='win32'&&await fs.stat(bundled).then(x=>x.isFile(),()=>false)?bundled:process.platform==='win32'?'py':'python3');
 const env={...harnessEnvironment(),COMMAND_DECK_MCP_DIR:path.resolve('.'),COMMAND_DECK_URL:process.env.COMMAND_DECK_URL??'http://127.0.0.1:8788',COMMAND_DECK_DATA_DIR:path.resolve(process.env.COMMAND_DECK_DATA_DIR??'data')};
 transport=new StdioClientTransport({command:python,args:[...(python==='py'?['-3']:[]),script],cwd:root,env,stderr:'pipe'});
 const client=new Client({name:'command-deck-local-assistant',version:'1.0.0'});
 await client.connect(transport,{timeout:15000});
 return client;
}
async function client(){connection??=connect().catch(error=>{connection=undefined;throw error;});return connection;}
let consultationActive=false;
export async function harnessCall(name:'consult'|'command_deck_tools'|'command_deck_call',args:Record<string,unknown>,timeoutMs=180000):Promise<HarnessReply> {
 if(name==='consult'&&consultationActive)throw new PublicError('Local DeepSeek is busy. Quick local messages still work; retry this reasoning request shortly.',429);
 if(name==='consult')consultationActive=true;
 try{const {traceEngineering}=await import('./engineering.js');return await traceEngineering('model.mcp.'+name,()=>untracedHarnessCall(name,args,timeoutMs));}finally{if(name==='consult')consultationActive=false;}
}
async function untracedHarnessCall(name:'consult'|'command_deck_tools'|'command_deck_call',args:Record<string,unknown>,timeoutMs:number):Promise<HarnessReply> {
 try {
  const c=await client();const result=await c.callTool({name,arguments:args},undefined,{timeout:timeoutMs});
  const content=Array.isArray(result.content)?result.content:[];
  const text=content.filter(x=>x.type==='text').map(x=>String(x.text)).join('\n');
  if(result.isError)throw new PublicError(text.slice(0,500)||'DeepSeek MCP returned a tool error.',503);
  return {text,metadata:(result.structuredContent??{}) as Record<string,unknown>};
 }catch(error){if(error instanceof PublicError)throw error;connection=undefined;await transport?.close().catch(()=>undefined);throw new PublicError('The local DeepSeek MCP harness is unavailable or timed out. Start Ollama and retry.',503);}
}
export async function consultLocal(prompt:string,system:string,options:{maxOutputTokens?:number;timeoutMs?:number;retryTruncated?:boolean}={}){
 let result=await harnessCall('consult',{prompt,system_prompt:system,max_output_tokens:options.maxOutputTokens??2400},options.timeoutMs??180000);
 if(result.metadata.done_reason==='length'&&options.retryTruncated!==false)result=await harnessCall('consult',{prompt,system_prompt:system,max_output_tokens:4096});
 if(result.metadata.done_reason==='length')throw new PublicError('DeepSeek did not finish its response. Shorten the request and retry.',503);
 return result;
}
/** One structured inference, requested through the existing DeepSeek -> Deck MCP bridge. */
export async function planLocalViaMcp(prompt:string,system:string,toolIds:string[]):Promise<HarnessReply>{
 const reply=await harnessCall('command_deck_call',{tool:'plan_local_task',arguments:{prompt,system,toolIds},allow_state_changes:false},70000);
 const body=JSON.parse(reply.text) as {plan:unknown;model:string;local:boolean};
 if(!body.plan)throw new PublicError('Local MCP planning returned no plan.',503);
 return {text:JSON.stringify(body.plan),metadata:{...reply.metadata,model:body.model,local:body.local,structured:true}};
}
/** The MCP-facing endpoint proposes a plan only. Execution remains in submitChat after policy checks. */
export async function structuredLocalPlan(prompt:string,system:string,toolIds:string[]) {
 if(consultationActive)throw new PublicError('Local DeepSeek is busy. Quick local messages still work; retry shortly.',429);
 consultationActive=true;
 try{
  const format={type:'object',properties:{answer:{type:'string',maxLength:240},actions:{type:'array',maxItems:3,items:{type:'object',properties:{tool:{type:'string',enum:toolIds},input:{type:'object'}},required:['tool','input'],additionalProperties:false}}},required:['answer','actions'],additionalProperties:false};
  const response=await fetch('http://127.0.0.1:11434/api/generate',{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{'Content-Type':'application/json'},body:JSON.stringify({model:'deepseek-r1:1.5b',system,prompt,format,think:false,stream:false,keep_alive:'15m',options:{temperature:0,num_ctx:4096,num_predict:700}})});
  if(!response.ok)throw new PublicError('Local structured planning is unavailable. Start Ollama and retry.',503);
  const data=await response.json() as {response?:string;done_reason?:string};
  if(!data.response||data.done_reason==='length')throw new PublicError('DeepSeek could not finish a complete task plan within its budget. No tool was executed.',503);
  return data.response;
 }catch(error){if(error instanceof PublicError)throw error;throw new PublicError('Local task planning timed out or became unavailable. No tool was executed.',503);}
 finally{consultationActive=false;}
}
export async function closeDeepSeekGateway(){await transport?.close();connection=undefined;transport=undefined;}
