import {useEffect, useState} from 'react';
import {ExternalLink, LoaderCircle, RefreshCw} from 'lucide-react';
import {request} from '../api';
import './northstar-studio.css';

export function NorthstarStudio({hosted}:{hosted:boolean}) {
 const [ready,setReady]=useState(false);
 const [error,setError]=useState('');
 const [attempt,setAttempt]=useState(0);
 useEffect(()=>{
  if(hosted)return;
  let live=true;
  setReady(false);setError('');
  void request<{origin:string}>('/api/local/northstar/studio',{method:'POST',body:'{}'})
   .then(()=>{if(live)setReady(true);})
   .catch(cause=>{if(live)setError(cause instanceof Error?cause.message:'North Star could not start.');});
  return()=>{live=false;};
 },[hosted,attempt]);
 return <main className="northstar-section" aria-label="North Star agentic web app creator">
  <header className="northstar-section-toolbar"><h1>North Star</h1><a href="http://127.0.0.1:8790" target="_blank" rel="noreferrer">Open standalone <ExternalLink size={15}/></a></header>
  {hosted?<div className="northstar-start-state"><h2>Open North Star locally</h2><p>The complete studio runs from your local Command Deck.</p></div>
   :error?<div className="northstar-start-state" role="alert"><h2>North Star is unavailable</h2><p>{error}</p><button onClick={()=>setAttempt(n=>n+1)}><RefreshCw size={16}/>Retry</button></div>
   :ready?<iframe className="northstar-studio-frame" title="North Star standalone agentic web app creator" src="http://127.0.0.1:8790"/>
   :<div className="northstar-start-state" role="status"><LoaderCircle className="spin"/><p>Starting North Star studio…</p></div>}
 </main>;
}
