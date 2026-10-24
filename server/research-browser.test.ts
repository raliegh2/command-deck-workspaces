import {it,expect,vi} from 'vitest';
import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';
import {publicGet} from './public-web.js';
import {renderPublicPage} from './research-browser.js';
vi.mock('./public-web.js',async original=>({...await original<typeof import('./public-web.js')>(),publicGet:vi.fn()}));
it.skipIf(process.platform!=='win32')('renders public JavaScript while blocking private traffic and alternate transports',async()=>{
 let privateHits=0;const server=createServer((_req,res)=>{privateHits++;res.end('PRIVATE');});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const port=(server.address() as AddressInfo).port;
 try{vi.mocked(publicGet).mockImplementation(async url=>{const body=url.endsWith('/data')?'PUBLIC_JSON':'<!doctype html><body>Initial public document<script>fetch("http://127.0.0.1:'+port+'/private").catch(()=>{});fetch("/data").then(r=>r.text()).then(t=>{document.body.append(t+" RTC_"+typeof RTCPeerConnection+" TRANSPORT_"+typeof WebTransport)});</script></body>';return {url,status:200,type:url.endsWith('/data')?'text/plain':'text/html',body,bytes:Buffer.from(body)};});const result=await renderPublicPage('https://example.org/start',async()=>undefined);expect(result.html).toContain('PUBLIC_JSON RTC_undefined TRANSPORT_undefined');expect(privateHits).toBe(0);expect(vi.mocked(publicGet).mock.calls.every(([url])=>new URL(url).origin==='https://example.org')).toBe(true);}finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
},30000);
