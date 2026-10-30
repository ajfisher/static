import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const SOURCE = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
const CURRENT_CACHE = 'static-pwa-v4.2-buffered-lockscreen-test';

function createWorker(initialCaches = {}) {
  const names = new Set(Object.keys(initialCaches));
  const entries = new Map(Object.entries(initialCaches));
  const handlers = {};
  const deleted = [];
  const opened = [];
  const networkRequests = [];
  let claimed = false;

  const caches = {
    keys: async () => [...names],
    delete: async name => {
      deleted.push(name);
      entries.delete(name);
      return names.delete(name);
    },
    open: async name => {
      opened.push(name);
      names.add(name);
      if (!entries.has(name)) entries.set(name, new Map());
      return {
        match: async request => entries.get(name).get(request.url),
        addAll: async () => {}
      };
    }
  };
  const self = {
    location: { origin: 'https://ajfisher.github.io' },
    addEventListener: (name, callback) => { handlers[name] = callback; },
    skipWaiting: async () => {},
    clients: { claim: async () => { claimed = true; } }
  };
  const fetch = async request => {
    networkRequests.push(request.url);
    return { source: 'network', url: request.url };
  };

  runInNewContext(SOURCE, { caches, self, fetch, URL, Promise });
  return { handlers, deleted, opened, networkRequests, names, claimed: () => claimed };
}

async function activate(worker) {
  let pending;
  worker.handlers.activate({ waitUntil: promise => { pending = promise; } });
  assert.ok(pending, 'activation should wait for cache cleanup and client claim');
  await pending;
}

async function request(worker, url, method = 'GET') {
  let pending;
  worker.handlers.fetch({
    request: { url, method },
    respondWith: promise => { pending = promise; }
  });
  return pending ? await pending : undefined;
}

test('activation removes only obsolete Static caches, not other PWAs on the origin', async () => {
  const worker = createWorker({
    [CURRENT_CACHE]: new Map(),
    'static-pwa-v3-something': new Map(),
    'static-pwa-v4-irregular-motion': new Map(),
    'static-pwa-v4.1-background-output-test': new Map(),
    'static-pwa-v2-something': new Map(),
    'unrelated-pwa-v1': new Map(),
    'another-project-cache': new Map()
  });

  await activate(worker);

  assert.deepEqual(worker.deleted.sort(), ['static-pwa-v2-something', 'static-pwa-v3-something', 'static-pwa-v4-irregular-motion', 'static-pwa-v4.1-background-output-test']);
  assert.deepEqual([...worker.names].sort(), [CURRENT_CACHE, 'another-project-cache', 'unrelated-pwa-v1'].sort());
  assert.equal(worker.claimed(), true);
});

test('fetch reads only the current Static cache, not unrelated origin-wide caches', async () => {
  const url = 'https://ajfisher.github.io/static/index.html';
  const worker = createWorker({
    [CURRENT_CACHE]: new Map(),
    'unrelated-pwa-v1': new Map([[url, { source: 'wrong-pwa' }]])
  });

  const result = await request(worker, url);
  assert.equal(result.source, 'network');
  assert.deepEqual(worker.opened, [CURRENT_CACHE]);
  assert.deepEqual(worker.networkRequests, [url]);
});

test('fetch serves cached Static assets and leaves other origins to the browser', async () => {
  const url = 'https://ajfisher.github.io/static/app.js';
  const worker = createWorker({
    [CURRENT_CACHE]: new Map([[url, { source: 'static-cache' }]])
  });

  assert.equal((await request(worker, url)).source, 'static-cache');
  assert.equal(await request(worker, 'https://example.com/other.js'), undefined);
  assert.equal(await request(worker, url, 'POST'), undefined);
  assert.deepEqual(worker.networkRequests, []);
});
