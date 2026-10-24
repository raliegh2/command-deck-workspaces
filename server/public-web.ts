import {gunzipSync,inflateSync,brotliDecompressSync} from 'node:zlib';
import http from 'node:http';
import https from 'node:https';
import {lookup} from 'node:dns/promises';
import {isIP} from 'node:net';
import {PublicError} from './errors.js';

export function publicAddress(address:string){
 let a=address.toLowerCase();if(isIP(a)===6){a=new URL('http://['+a+']/').hostname.slice(1,-1);const second=parseInt(a.split(':')[1]||'0',16);return /^[23][0-9a-f]{0,3}:/.test(a)&&!a.startsWith('2002:')&&!a.startsWith('3fff:')&&!a.startsWith('2001:db8:')&&!(a.startsWith('2001:')&&second<0x200);}
 if(isIP(a)!==4)return false;const [x,y,z]=a.split('.').map(Number);return !(a==='168.63.129.16'||x===0||x===10||x===127||x>=224||x===169&&y===254||x===172&&y>=16&&y<=31||x===192&&(y===168||y===0||y===2)||x===100&&y>=64&&y<=127||x===198&&(y===18||y===19||y===51&&z===100)||x===203&&y===0&&z===113);
}
export function publicUrl(raw:string){
 const u=new URL(raw);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.port&&!['80','443'].includes(u.port)||/^(?:localhost|metadata)(?:\.|$)/i.test(u.hostname)||/\.(?:local|localhost|internal|test|invalid)$/i.test(u.hostname))throw new PublicError('Only public HTTP/HTTPS pages without credentials are supported.',400);
 const host=u.hostname.replace(/^\[|\]$/g,'');if(isIP(host)&&!publicAddress(host))throw new PublicError('Private and reserved network addresses are blocked.',400);if([...u.searchParams.keys()].some(k=>/password|secret|token|api[_-]?key|authorization/i.test(k)))throw new PublicError('Remove credentials from source URLs.',400);u.hash='';return u;
}
export async function publicGet(raw:string,redirects=0,beforeRedirect?:(url:string)=>Promise<void>):Promise<{url:string;status:number;type:string;body:string;bytes:Buffer}>{
 const u=publicUrl(raw);const host=u.hostname.replace(/^\[|\]$/g,'');const addresses=isIP(host)?[{address:host,family:isIP(host)}]:await lookup(host,{all:true,verbatim:true});if(!addresses.length||addresses.some(a=>!publicAddress(a.address)))throw new PublicError('The page resolves to a private or reserved address.',400);
 const address=addresses[0];return new Promise((resolve,reject)=>{const request=(u.protocol==='https:'?https:http).request(u,{method:'GET',agent:false,lookup:(_hostname,options,callback)=>{if(options.all)(callback as Function)(null,[address]);else callback(null,address.address,address.family);},headers:{'User-Agent':'CommandDeckResearch/1.0 (public research; robots-aware)','Accept':'text/html,application/json,text/plain;q=0.8','Accept-Encoding':'identity'}},res=>{
  const status=res.statusCode??0;if([301,302,303,307,308].includes(status)&&res.headers.location){res.resume();if(redirects>=3){reject(new PublicError('Source exceeded three redirects.',400));return;}let target:string;try{target=publicUrl(new URL(res.headers.location,u).href).href;}catch(error){reject(error);return;}void Promise.resolve(beforeRedirect?.(target)).then(()=>publicGet(target,redirects+1,beforeRedirect)).then(resolve,reject);return;}
  const chunks:Buffer[]=[];let size=0;res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>1500000){res.destroy();request.destroy(new PublicError('Source exceeds the 1.5 MB page limit.',400));}else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>{try{const type=String(res.headers['content-type']??'');const bytes=decodePublicBytes(Buffer.concat(chunks),String(res.headers['content-encoding']??'identity'));const body=/pdf/i.test(type)?'':new TextDecoder(type.match(/charset=([\w-]+)/i)?.[1]??'utf-8').decode(bytes);resolve({url:u.href,status,type,body,bytes});}catch{reject(new PublicError('Source decoding failed or expanded page exceeded 3 MB.',400));}});
 });request.setTimeout(12000,()=>request.destroy(new PublicError('Source timed out after 12 seconds.',504)));request.on('error',reject);request.end();});
}
export function robotsPermit(text:string,pathname:string){
 const groups:Array<{agents:string[];rules:Array<{allow:boolean;path:string}>}>=[];let current={agents:[] as string[],rules:[] as Array<{allow:boolean;path:string}>};
 for(const original of text.split(/\r?\n/)){const line=original.split('#')[0].trim();const match=line.match(/^([^:]+):\s*(.*)$/);if(!match)continue;const key=match[1].trim().toLowerCase(),value=match[2].trim();if(key==='user-agent'){if(current.rules.length){groups.push(current);current={agents:[],rules:[]};}current.agents.push(value.toLowerCase());}else if((key==='allow'||key==='disallow')&&value)current.rules.push({allow:key==='allow',path:value});}groups.push(current);
 const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&'commanddeckresearch'.includes(a)));const selected=specific.length?specific:groups.filter(g=>g.agents.includes('*'));let best:{allow:boolean;length:number}|undefined;
 for(const r of selected.flatMap(g=>g.rules)){const expression=r.path.split('*').map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$');if(new RegExp('^'+expression).test(pathname)&&(!best||r.path.length>best.length||r.path.length===best.length&&r.allow))best={allow:r.allow,length:r.path.length};}return best?.allow??true;
}

export function decodePublicBytes(input:Buffer,encoding:string){let bytes:Buffer<ArrayBufferLike>=input;encoding=encoding.toLowerCase();if(encoding==="gzip")bytes=gunzipSync(bytes,{maxOutputLength:3000000});else if(encoding==="deflate")bytes=inflateSync(bytes,{maxOutputLength:3000000});else if(encoding==="br")bytes=brotliDecompressSync(bytes,{maxOutputLength:3000000});else if(encoding!=="identity")throw Error("Unsupported response encoding");if(bytes.length>3000000)throw Error("Expanded response limit");return bytes;}
export function decodePublicBody(input:Buffer,encoding:string,charset="utf-8"){return new TextDecoder(charset).decode(decodePublicBytes(input,encoding));}
