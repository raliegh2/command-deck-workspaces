const hidden=/(?:Path$)|^(?:id|hash|digest|trace|path|root|filename|reviewPath|workspace|ownerPid|raw|headers|token|secret|password|input|config|at|modelEndpoint|paidFallback|maxHeavyJobs|check|url|dependency|skill|input|lastSuccess|lastFailure)$/i;
function label(key:string){return key.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' ').replace(/^./,s=>s.toUpperCase());}
function Value({value,depth=0}:{value:unknown;depth?:number}){
 if(value===null||value===undefined)return <span>Unavailable</span>;
 if(typeof value==='boolean')return <span>{value?'Yes':'No'}</span>;
 if(typeof value!=='object'){const text=String(value);return <span>{/^(?:[a-z]:[\\/]|\/[^\/]|http:\/\/(?:127\.0\.0\.1|localhost))/i.test(text)?'Local resource · see advanced receipt':text}</span>;}
 if(depth>3)return <span>{Array.isArray(value)?`${value.length} items`:'Details available in advanced receipt'}</span>;
 if(Array.isArray(value))return value.length?<ul>{value.slice(0,20).map((v,i)=><li key={i}><Value value={v} depth={depth+1}/></li>)}</ul>:<span>No items</span>;
 return <dl>{Object.entries(value).filter(([key])=>!hidden.test(key)).map(([key,v])=><div key={key}><dt>{label(key)}</dt><dd><Value value={v} depth={depth+1}/></dd></div>)}</dl>;
}
export function FriendlyResult({value}:{value:unknown}){const health=value as {services?:{name:string;ready:boolean}[];capabilities?:unknown[];dockerReady?:boolean};return <div className="ws-result">{Array.isArray(health?.services)&&Array.isArray(health?.capabilities)?<><p>{health.services.filter(s=>s.ready).length} of {health.services.length} services ready · {health.capabilities.length} tools registered.</p><ul>{health.services.map(s=><li key={s.name}>{s.name}: {s.ready?'Ready':'Unavailable'}</li>)}</ul><p>Container engine: {health.dockerReady?'Ready':'Unavailable'}</p></>:<Value value={value}/>}<details><summary>Advanced receipt</summary><pre>{JSON.stringify(value,null,2)}</pre></details></div>;}
