// service-worker.js
const CACHE_NAME = 'awl-cache-v3';
const ASSETS = [
  '/',               // índice (cache de shell)
  '/index.html',     // para fallback de navegação
  '/style.css',
  '/main.js',
  '/manifest.json',
  // adicione aqui qualquer outro arquivo estático que queira pré-cachear
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// network-first para API e assets; 
// network-only para navegações, com fallback para /index.html se offline
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 1) Se for navegação (page load), tenta rede e, em offline, retorna cache de /index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(res => res)
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2) Para requisições aos nossos próprios assets ou API, network-first com cache fallback
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(request)
        .then(networkRes => {
          // atualiza cache
          const copy = networkRes.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return networkRes;
        })
        .catch(() => caches.match(request))
    );
  }

  // 3) Fora do nosso domínio, deixa seguir normalmente
});
