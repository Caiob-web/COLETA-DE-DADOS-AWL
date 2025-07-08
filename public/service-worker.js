// service-worker.js

// 1) Nome da cache – incremente quando trocar assets
const CACHE_NAME = 'awl-cache-v3';

// 2) Lista de arquivos estáticos para pré-cache (shell da PWA)
const ASSETS = [
  '/',            // index.html (navegação)
  '/index.html',  // fallback de navegação offline
  '/style.css',
  '/main.js',
  '/manifest.json',
  // ...adicione aqui outras assets estáticas que queira pré-cachear
];

// 3) Durante a instalação, pré-cacheamos todos os ASSETS e ativamos imediatamente
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()) // força o SW a ativar sem esperar
  );
});

// 4) Ao ativar, removemos caches antigos e assumimos o controle das páginas
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
      .then(() => self.clients.claim()) // passa a controlar todas as abas abertas
  );
});

// 5) Estratégia de fetch:
//    - Navegações (mode === 'navigate'): network-only, com fallback para /index.html offline
//    - Outros assets/API do nosso domínio: network-first, atualiza cache e fallback para cache
//    - Qualquer outra requisição externa: deixa seguir normalmente
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // 5.1) Se for navegação (page load)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => response)
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 5.2) Se for um asset ou chamada API do mesmo domínio
  if (url.origin === location.origin) {
    event.respondWith(
      fetch(request)
        .then(networkResponse => {
          // atualiza cache
          const copy = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, copy));
          return networkResponse;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // 5.3) Para qualquer outra origem, não interferimos
});
