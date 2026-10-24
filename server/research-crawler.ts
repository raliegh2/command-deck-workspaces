import {publicUrl} from './public-web.js';
import {cleanMemory} from './neural-memory.js';
export type CrawlItem={url:string;depth:number};
export const crawlControls=new Map<string,{action?:'pause'|'cancel'}>();
export function crawlLinks(links:string[],base:string,domains:string[],depth:number,maxDepth:number):CrawlItem[]{
 if(depth>=maxDepth)return [];
 return [...new Set(links.map(link=>{try{const u=publicUrl(new URL(link,base).href);if(!domains.includes(u.hostname)||/\.(?:png|jpe?g|gif|svg|zip|exe|mp[34]|css|js)$/i.test(u.pathname)||/\/(?:logout|signout|delete|checkout|cart|login|signin)(?:\/|$)/i.test(u.pathname))return '';return u.href;}catch{return '';}}).filter(Boolean))].slice(0,150).map(url=>({url,depth:depth+1}));
}
export function tableRecords(tables:Array<Array<Array<string|null>>>,fields:string[],sourceId:string){const rows:Array<{sourceId:string;values:Record<string,string|null>;evidence:Record<string,string>}>=[];
 for(const table of tables){if(table.length<2)continue;const headers=table[0].map(h=>String(h??'').trim().toLowerCase().replace(/\s+/g,'_'));if(!fields.some(f=>headers.includes(f)))continue;for(const row of table.slice(1)){const values:Record<string,string|null>={},evidence:Record<string,string>={};for(const f of fields){const index=headers.indexOf(f),v=index>=0?row[index]:null;values[f]=v?cleanMemory(String(v)).slice(0,500):null;if(values[f])evidence[f]='Table column '+f+': '+values[f];}if(Object.values(values).some(Boolean))rows.push({sourceId,values,evidence});}}return rows.slice(0,100);
}
export function compareResearch(previous:Array<{values:Record<string,string|null>}>,next:Array<{values:Record<string,string|null>}>){const rows=(r:typeof previous)=>new Set(r.map(x=>JSON.stringify(Object.fromEntries(Object.entries(x.values).sort(([a],[b])=>a.localeCompare(b))))));const a=rows(previous),b=rows(next);return {added:[...b].filter(x=>!a.has(x)).length,removed:[...a].filter(x=>!b.has(x)).length,unchanged:[...b].filter(x=>a.has(x)).length};}
