'use strict';

const CACHE = 'gulrez-v1';
const OFFLINE_URL = '/offline.html';

const PRECACHE = [
  '/',
  '/index.html',
  '/catalog.html',
  '/product.html',
  '/user.html',
  '/offline.html',
  '/manifest.json',
  '/css/style.css',
  '/css/catalog.css',
  '/css/product.css',
  '/css/user.css',
  '/js/script.js',
  '/js/push.js',
  '/js/pwa.js',
  '/js/language.js',
  '/icons/web-app-manifest-192x192.png',
  '/icons/web-app-manifest-512x512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.svg',
];

// URLs that must never be served from cache
function isPrivateApi(url) {
  const p = new URL(url).pathname;
  return (
    p.startsWith('/api/orders') ||
    p.startsWith('/api/me') ||
    p.startsWith('/api/admin') ||
    p.startsWith('/api/user') ||
    p.startsWith('/api/push') ||
    p.startsWith('/api/auth') ||
    p.startsWith('/api/login') ||
    p.startsWith('/api/logout') ||
    p.startsWith('/api/register')
  );
}

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;

  const url = request.url;

  // Always go to network for private API calls — never cache
  if (isPrivateApi(url)) {
    e.respondWith(fetch(request));
    return;
  }

  // For HTML navigation requests: network-first, fall back to offline page
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then(res => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(CACHE).then(c => c.put(request, clone));
          }
          return res;
        })
        .catch(() =>
          caches.match(request).then(cached => cached || caches.match(OFFLINE_URL))
        )
    );
    return;
  }

  // For everything else: cache-first, then network
  e.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(res => {
        if (res.ok && res.type === 'basic') {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(request, clone));
        }
        return res;
      });
    })
  );
});

// ─── Push Notifications ──────────────────────────────────────────────────────

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) {}
  e.waitUntil(
    self.registration.showNotification(d.title || 'GULREZ', {
      body:     d.body  || '',
      icon:     '/icons/web-app-manifest-192x192.png',
      badge:    '/icons/favicon-96x96.png',
      data:     { url: d.url || '/' },
      tag:      d.tag   || 'gulrez',
      renotify: true,
      vibrate:  [200, 100, 200]
    })
  );
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return clients.openWindow(url);
    })
  );
});
