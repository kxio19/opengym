/* openGym service worker — runtime caching (works with Vite's hashed asset names).
   Immutable Vite assets and media (img/gif) are cache-first; everything else is
   network-first with offline fallback. */
const RUNTIME_CACHE = 'opengym-rt-v1'
const ASSET_CACHE = 'opengym-assets-v1'
const MAX_ASSET_ENTRIES = 80
const ASSET_PATH = new URL('assets/', self.registration.scope).pathname

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(request)
  if (hit) return hit

  const response = await fetch(request)
  if (response.ok) {
    await cache.put(request, response.clone())
    if (maxEntries) {
      const keys = await cache.keys()
      await Promise.all(keys.slice(0, Math.max(0, keys.length - maxEntries)).map(key => cache.delete(key)))
    }
  }
  return response
}

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', e => {
  e.waitUntil(Promise.all([
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== RUNTIME_CACHE && k !== ASSET_CACHE).map(k => caches.delete(k)))
    ),
    // Migrate assets stored by the previous all-in-one network-first strategy.
    caches.open(RUNTIME_CACHE).then(cache => cache.keys().then(keys =>
      Promise.all(keys.filter(key => new URL(key.url).pathname.startsWith(ASSET_PATH)).map(key => cache.delete(key)))
    ))
  ]).then(() => self.clients.claim()))
})
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(data.title || 'openGym', {
    body: data.body || '',
    icon: 'icon-512.png',
    badge: 'icon-180.png',
    tag: data.tag || 'opengym',
    renotify: true,
    data: data.url ? { url: data.url } : {}
  }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url
  const target = new URL(url || './', self.registration.scope).href
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(clients => {
    const c = clients.find(c => 'focus' in c)
    return c ? (url ? c.navigate(target).then(() => c.focus()) : c.focus()) : self.clients.openWindow(target)
  }))
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return
  const isExercisePhoto = /^\/api\/exercise-photo\/[^/]+$/.test(url.pathname)
  if (isExercisePhoto) {
    // Cache by immutable id on this single-user device; network requests retain credentials when needed.
    e.respondWith(cacheFirst(e.request, RUNTIME_CACHE))
    return
  }
  if (url.pathname.startsWith('/api/')) return    // never cache auth/data

  const isMedia = url.pathname.includes('/img/') || url.pathname.includes('/gif/')
  const isImmutableAsset = url.pathname.startsWith(ASSET_PATH)
  if (isImmutableAsset) {
    // index.html always revalidates and references new content hashes after a deploy,
    // so cache-first cannot hide releases. The cap removes stale hashes over time.
    e.respondWith(cacheFirst(e.request, ASSET_CACHE, MAX_ASSET_ENTRIES))
  } else if (isMedia) {
    e.respondWith(cacheFirst(e.request, RUNTIME_CACHE))
  } else {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(RUNTIME_CACHE).then(c => c.put(e.request, res.clone()))
      return res
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))))
  }
})
