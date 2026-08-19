/* Service worker.

   Development (Live Server, node serve.js, a phone on the LAN, file://):
   completely disabled. The page does not register it, and if an old
   registration is still around it removes itself and drops every cache — a
   worker sitting in front of Live Server would keep serving yesterday's
   app.js and quietly undo your edits.

   Production: the app shell is cached so the log works offline. App code
   (HTML/CSS/JS) is network-first, so the newest deploy always wins when there
   is a connection and the cache is only a fallback. Cache-first is used just
   for icons and the manifest, which change only when their names do. */

const VERSION = 'v4';
const CACHE = 'ccpd-' + VERSION;

const SHELL = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/pdf.js',
  './js/record-pdf.js',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* Assets safe to serve straight from the cache. */
const STATIC = /\.(png|svg|ico|webmanifest)$/i;

const HOST = self.location.hostname;
const DEV_HOST =
  HOST === 'localhost' || HOST === '127.0.0.1' || HOST === '::1' ||
  /\.local$/i.test(HOST) ||
  /^192\.168\./.test(HOST) ||
  /^10\./.test(HOST) ||
  /^172\.(1[6-9]|2\d|3[01])\./.test(HOST);

if (DEV_HOST) selfDestruct(); else enableOfflineCache();

/* ---------------------------------------------------------------- */

function selfDestruct() {
  self.addEventListener('install', () => self.skipWaiting());

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
        .then(() => self.registration.unregister())
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((c) => c.navigate(c.url)))
        .catch(() => {})
    );
  });

  /* No fetch handler at all: every request goes straight to the network. */
}

function enableOfflineCache() {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE)
        .then((c) => Promise.allSettled(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })))))
        .then(() => self.skipWaiting())
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
        .then(() => self.clients.claim())
    );
  });

  /* Lets the page force an immediate takeover after an update is found. */
  self.addEventListener('message', (event) => {
    if (event.data === 'skip-waiting') self.skipWaiting();
  });

  self.addEventListener('fetch', (event) => {
    const req = event.request;
    if (req.method !== 'GET') return;

    const url = new URL(req.url);
    if (url.origin !== self.location.origin) return;

    if (STATIC.test(url.pathname)) {
      event.respondWith(
        caches.match(req).then((hit) => hit || fetch(req).then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }))
      );
      return;
    }

    /* network-first, so code updates land immediately */
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || caches.match('./index.html')))
    );
  });
}
