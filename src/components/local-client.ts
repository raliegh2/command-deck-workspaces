import {request} from '../api';
export type Job={id:string;tool:string;status:string;projectId:string;createdAt:string;updatedAt:string;result:unknown;error:string;phase?:string};
export type Message={id:string;role:string;text:string;at:string;jobs?:string[];routing?:{mode:'local'|'deepseek';durationMs:number};sources?:Array<{label:string;title:string;locator:string;updatedAt:string}>};
export type Session={id:string;projectId:string;title:string;messages:Message[]};
export type Tool={id:string;name:string;group:string;instruction:string;input:string};
export type Probe={at:string;status:number|null;ok:boolean;latencyMs:number;signal:string};
export type Traffic={at:string;rate:number;baseline:number|null;status:string;source:string;detail:string};
export type Watch={sensors?:Array<{projectId:string;state:string;detail:string;lastEventAt:string|null}>;enabled:boolean;intervalSeconds:number;coverage:string;projects:Array<{id:string;name:string;url:string;probes:Probe[];traffic:Traffic[]}>};
export const localApi={
 catalog:()=>request<{tools:Tool[];harness:string;model:string}>('/api/local/tools'),
 sessions:()=>request<{sessions:Array<{id:string;title:string;projectId:string}>}>('/api/local/sessions'),
 session:(id:string)=>request<Session>('/api/local/sessions/'+id),
 create:(projectId:string,title:string)=>request<Session>('/api/local/sessions',{method:'POST',body:JSON.stringify({projectId,title})}),
 send:(id:string,prompt:string)=>request<Job>('/api/local/sessions/'+id+'/messages',{method:'POST',body:JSON.stringify({prompt})}),
 jobs:()=>request<{jobs:Job[]}>('/api/local/jobs'),
 job:(id:string)=>request<Job>('/api/local/jobs/'+id),
 run:(id:string,projectId:string,input:Record<string,unknown>={})=>request<Job>('/api/local/tools/'+id+'/run',{method:'POST',body:JSON.stringify({projectId,input})}),
 watch:()=>request<Watch>('/api/local/watch'),
 monitoring:(enabled:boolean)=>request<Watch>('/api/local/watch',{method:'POST',body:JSON.stringify({enabled})}),
 traffic:(data:unknown)=>request('/api/local/traffic',{method:'POST',body:JSON.stringify(data)}),
};
export const finished=(job:Job)=>!['queued','running'].includes(job.status);
export const errorMessage=(cause:unknown)=>cause instanceof Error?cause.message:'The local service is unavailable. Retry after starting Command Deck.';
