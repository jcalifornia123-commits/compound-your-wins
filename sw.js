const CACHE='compound-wins-v2';
const ASSETS=[
  './',
  'index.html',
  'style.css',
  'db.js',
  'app.js',
  'manifest.json',
  'fonts/dm-sans-latin.woff2',
  'fonts/space-grotesk-latin.woff2',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png'
];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  if(new URL(req.url).origin!==location.origin)return;
  event.respondWith(
    caches.match(req).then(cached=>{
      if(cached)return cached;
      return fetch(req).then(res=>{
        const copy=res.clone();
        caches.open(CACHE).then(cache=>cache.put(req,copy));
        return res;
      }).catch(()=>{
        if(req.mode==='navigate')return caches.match('index.html');
      });
    })
  );
});
