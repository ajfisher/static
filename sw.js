// Minimal offline-first service worker. No runtime API calls or third-party requests.
const CACHE_PREFIX = 'static-pwa-';
const CACHE = `${CACHE_PREFIX}v4.3-opus-mse-test`;
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './config.js',
  './audio-engine.js',
  './audio-output.js',
  './buffered-render.js',
  './buffered-playback.js',
  './webm-opus.js',
  './opus-encoder.js',
  './pcm-seam.js',
  './opus-stream.js',
  './noise-worklet.js',
  './thunder-worklet.js',
  './prime-motion-worklet.js',
  './prime-motion-core.js',
  './personal-presets.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      caches.keys().then(names => Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE).map(name => caches.delete(name)))),
      self.clients.claim()
    ])
  );
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(cache => cache.match(event.request)).then(cached => cached || fetch(event.request))
  );
});
