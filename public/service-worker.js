// service-worker.js

const CACHE_NAME = 'awl-cache-v2';
const ASSETS = [
  '/',            // HTML principal
  '/style.css',   // Seu CSS
  '/main.js',     // Seu JS renomeado
  '/manifest.json',
  // Liste aqui outras assets estáticas que você queira cachear
];

// Ao instalar, pré-cacheamos somente os assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// Ao ativar, limpamos caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
    .then(() => self.clients.claim())
  );
});

// Estratégia network-first: tenta a rede, cai no cache se falhar
self.addEventListener('fetch', event => {
  // Só interceptamos GET para nossos próprios assets
  if (event.request.method !== 'GET' || !event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Se vier da rede com sucesso, atualiza o cache
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() =>
        // Se der erro (offline), busca no cache
        caches.match(event.request)
      )
  );
});
