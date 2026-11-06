/* MEDIA WADUL GUS'E — Service Worker v1.34.1
   Strategi: navigation/config network-first agar versi baru tidak tertahan cache.
*/
const CACHE_NAME='mwg-shell-v1.34.1';
const INDEX_URL='./index.html';

self.addEventListener('install',event=>{
  // Activate only after the complete new shell exists for offline reloads.
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE_NAME);
    await cache.addAll(['./index.html','./app.js?v=1.34.1','./app.css?v=1.34.0','./staff-roster.js?v=1.34.0','./staff-roster.css?v=1.34.0','./brief-import.js?v=1.34.1','./brief-import.css?v=1.33.0']);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>(k.startsWith('mwg-shell-')||k.startsWith('media-wadul-guse-'))&&k!==CACHE_NAME).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

async function networkFirst(request,{cacheFallback=true}={}){
  const cache=await caches.open(CACHE_NAME);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response&&response.ok&&request.method==='GET'){
      try{await cache.put(request,response.clone())}catch(_){ }
    }
    return response;
  }catch(error){
    if(cacheFallback){
      const cached=await cache.match(request,{ignoreSearch:true});
      if(cached)return cached;
      const index=await cache.match(INDEX_URL,{ignoreSearch:true});
      if(index&&request.mode==='navigate')return index;
    }
    throw error;
  }
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET')return;
  const url=new URL(request.url);

  // Jangan pernah intercept Google Apps Script/API eksternal.
  if(url.origin!==self.location.origin)return;

  const isConfig=url.pathname.endsWith('/config.json');
  const isIndex=url.pathname.endsWith('/index.html')||url.pathname.endsWith('/');
  if(request.mode==='navigate'||isConfig||isIndex){
    event.respondWith(networkFirst(request,{cacheFallback:!isConfig}));
    return;
  }

  // Asset same-origin: cache-first, lalu refresh cache dari network saat belum ada.
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE_NAME);
    const cached=await cache.match(request);
    if(cached)return cached;
    const response=await fetch(request);
    if(response&&response.ok){try{await cache.put(request,response.clone())}catch(_){ }}
    return response;
  })());
});

self.addEventListener('message',event=>{
  if(event.data&&event.data.type==='SKIP_WAITING')self.skipWaiting();
});
