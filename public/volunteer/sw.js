const VERSION='deck-volunteer-v2';
const SHELL=['/volunteer/','/volunteer/index.html','/volunteer/app.js','/volunteer/style.css','/volunteer/manifest.json'];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('deck-volunteer-')&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
// Only static volunteer shell resources are cached. Authenticated responses never enter Cache Storage.
self.addEventListener('fetch',event=>{if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin||!SHELL.includes(new URL(event.request.url).pathname))return;event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();event.waitUntil(caches.open(VERSION).then(cache=>cache.put(event.request,copy)));}return response;}).catch(()=>caches.match(event.request)));});
