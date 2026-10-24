import {chromium} from 'playwright';
import {publicGet,publicUrl} from './public-web.js';

/** No direct browser network: every request is fulfilled by the DNS-pinned public client. */
export async function renderPublicPage(url:string,permit:(url:string)=>Promise<void>){
 const origin=publicUrl(url).origin;
 const browser=await chromium.launch({headless:true,args:['--force-webrtc-ip-handling-policy=disable_non_proxied_udp','--disable-background-networking'],...(process.platform==='win32'?{channel:'msedge'}:{})});
 const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false,userAgent:'CommandDeckResearch/1.0'});
 let count=0,blocked=0,bytes=0;const deadline=Date.now()+25000;
 try{
  await context.addInitScript(()=>{for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','WebTransport'])Object.defineProperty(globalThis,name,{value:undefined,configurable:false,writable:false});});
  await context.routeWebSocket(/.*/,socket=>socket.close());
  await context.route('**/*',async route=>{
   try{
    const req=route.request(),u=publicUrl(req.url());
    if(req.method()!=='GET'||u.origin!==origin||++count>35||Date.now()>deadline||!['document','script','stylesheet','xhr','fetch'].includes(req.resourceType()))throw Error('Outside public rendering scope');
    await permit(u.href);const response=await publicGet(u.href,0,async target=>{if(publicUrl(target).origin!==origin)throw Error('Cross-origin browser redirect blocked');await permit(target);});
    bytes+=response.bytes.length;if(bytes>6000000)throw Error('Browser response budget exceeded');
    await route.fulfill({status:response.status,contentType:response.type||'text/plain',body:response.bytes,headers:{'Content-Security-Policy':"default-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self'; worker-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'self'"}});
   }catch{blocked++;await route.abort().catch(()=>undefined);}
  });
  const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:25000});
  await page.waitForLoadState('networkidle',{timeout:4000}).catch(()=>undefined);
  return {html:(await page.content()).slice(0,1500000),blocked};
 }finally{await context.close();await browser.close();}
}
