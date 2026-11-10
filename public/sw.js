// ============================================================================
// Service Worker — HH Offshore · Infotec Brasil
// PWA Estático Seguro — Zero PII / Zero Interceptação de Dados Contratuais ou Autenticação
// ============================================================================

const CACHE_NAME = 'hhoff-static-v2';

// Assets estáticos públicos essenciais para pré-cache na instalação
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './infotec-logo.png',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

// Instalação: pré-cache dos assets essenciais e ativação imediata
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) =>
        cache.addAll(PRECACHE_ASSETS).catch((err) => {
          // Em ambiente dev ou caminhos dinâmicos, prossegue sem travar a instalação
          console.warn('[SW] Falha não crítica no pré-cache inicial:', err);
        })
      )
      .then(() => self.skipWaiting())
  );
});

// Ativação: remoção de caches legados e reivindicação imediata dos clientes
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key !== CACHE_NAME)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Interceptação de Fetch com regras inegociáveis de segurança
self.addEventListener('fetch', (event) => {
  const request = event.request;

  // 1. Apenas requisições GET são elegíveis para cache
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  // 2. Proibição absoluta de interceptar URLs externas de dados/APIs/Supabase
  const isSameOrigin = url.origin === self.location.origin;
  const isGoogleFonts =
    url.origin === 'https://fonts.googleapis.com' ||
    url.origin === 'https://fonts.gstatic.com';

  if (!isSameOrigin && !isGoogleFonts) {
    // Supabase (*.supabase.co), APIs remotas ou qualquer serviço externo: bypass total
    return;
  }

  // 3. Proibição de interceptar dados sensíveis, mesmo em topologia self-hosted (same-origin)
  const pathname = url.pathname.toLowerCase();
  const isSensitivePath =
    pathname.startsWith('/api') ||
    pathname.includes('/api/') ||
    pathname.startsWith('/auth') ||
    pathname.includes('/auth/') ||
    pathname.startsWith('/rest') ||
    pathname.includes('/rest/') ||
    pathname.startsWith('/functions') ||
    pathname.includes('/functions/') ||
    pathname.startsWith('/realtime') ||
    pathname.includes('/realtime/');

  if (isSensitivePath) {
    return;
  }

  // 4. Ignorar requisições com cabeçalhos de autenticação ou streams em tempo real (SSE)
  const acceptHeader = request.headers.get('accept') || '';
  if (
    request.headers.has('authorization') ||
    acceptHeader.includes('text/event-stream')
  ) {
    return;
  }

  // 5. Navegação HTML (requisição do documento principal) — Network-First
  // Garante que o usuário sempre receba a versão mais recente e só usa cache offline se a rede falhar
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          const indexCached = await caches.match('./index.html');
          if (indexCached) return indexCached;
          const rootCached = await caches.match('./');
          return rootCached || Response.error();
        })
    );
    return;
  }

  // 6. Chunks de produção versionados com hash (/assets/*.js, /assets/*.css) — Cache-First
  const isHashedAsset = pathname.includes('/assets/') && (
    pathname.endsWith('.js') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg')
  );

  if (isHashedAsset) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const copy = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 7. Demais assets estáticos (ícones, manifesto, fontes) — Stale-While-Revalidate
  const isStaticResource =
    isGoogleFonts ||
    pathname.endsWith('.webmanifest') ||
    pathname.endsWith('.png') ||
    pathname.endsWith('.svg') ||
    pathname.endsWith('.ico') ||
    pathname.endsWith('.woff2') ||
    pathname.endsWith('.css') ||
    pathname.endsWith('.js');

  if (isStaticResource) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        const fetchPromise = fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const copy = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
            }
            return networkResponse;
          })
          .catch(() => cachedResponse);

        return cachedResponse || fetchPromise;
      })
    );
  }
});
