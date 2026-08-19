// Locks the hosted Worker contract that GitHub Pages actually uses.
// Run: node --test scripts/test-sync-worker.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../workers/sync/src/index.js';

const ORIGIN = 'https://eighthundreds.github.io';
const TOKEN = 'a'.repeat(64);

function makeBucket() {
  const store = new Map();
  return {
    async list({ prefix }) {
      return {
        objects: [...store.values()].filter((o) => o.key.startsWith(prefix)),
        truncated: false,
      };
    },
    async get(key) {
      return store.get(key) ?? null;
    },
    async head(key) {
      const obj = store.get(key);
      if (!obj) return null;
      const { body: _body, ...meta } = obj;
      return meta;
    },
    async put(key, buf, opts = {}) {
      const existing = store.get(key);
      if (opts.onlyIf?.etagMatches && existing) {
        const have = String(existing.httpEtag || '').replaceAll('"', '');
        if (have !== opts.onlyIf.etagMatches) return null;
      }
      const httpEtag = `"etag-${store.size + 1}"`;
      const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
      store.set(key, {
        key,
        body: bytes,
        size: bytes.byteLength,
        httpEtag,
        uploaded: new Date('2026-08-19T00:00:00Z'),
        httpMetadata: opts.httpMetadata || {},
        customMetadata: opts.customMetadata || {},
      });
      return { httpEtag };
    },
    async delete(key) {
      store.delete(key);
    },
  };
}

function env(bucket = makeBucket()) {
  return { BUCKET: bucket };
}

function req(path, init = {}) {
  const headers = new Headers(init.headers);
  if (init.origin !== null) headers.set('Origin', init.origin || ORIGIN);
  return new Request(`https://thoughtdag-sync.test${path}`, { ...init, headers });
}

const handle = (request, workerEnv = env()) => worker.fetch(request, workerEnv);

const headerList = (res, name) =>
  (res.headers.get(name) || '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean);

test('OPTIONS /v1/objects allows Authorization + Cache-Control (Pages preflight)', async () => {
  const res = await handle(req('/v1/objects', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization,cache-control',
    },
  }));
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const allow = headerList(res, 'Access-Control-Allow-Headers');
  assert.ok(allow.includes('authorization'), `missing authorization in ${allow.join(', ')}`);
  assert.ok(
    allow.includes('cache-control'),
    `missing cache-control in ${allow.join(', ')} — the client sends it to bust disk cache; browsers CORS-fail the GET if preflight omits it`,
  );
  const methods = headerList(res, 'Access-Control-Allow-Methods');
  for (const m of ['get', 'put', 'post', 'options']) {
    assert.ok(methods.includes(m), `missing method ${m}`);
  }
});

test('OPTIONS echoes any requested header so a new client header cannot CORS-break the vault', async () => {
  const res = await handle(req('/v1/objects', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'authorization, x-thoughtdag-probe',
    },
  }));
  assert.equal(res.status, 204);
  assert.ok(headerList(res, 'Access-Control-Allow-Headers').includes('x-thoughtdag-probe'));
});

test('GET /v1/objects without a token is 401 with CORS, not a missing-header failure', async () => {
  const res = await handle(req('/v1/objects'));
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.deepEqual(await res.json(), { error: 'unauthorized' });
});

test('GET /v1/objects with a token lists the namespace and never caches', async () => {
  const res = await handle(req('/v1/objects', {
    headers: { Authorization: `Bearer ${TOKEN}` },
  }));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(res.headers.get('Last-Modified'), null);
  assert.deepEqual(await res.json(), { objects: [] });
});

test('GET /v1/objects/prefs has no-store and no Last-Modified (stale etag → 412)', async () => {
  const workerEnv = env();
  const put = await handle(req('/v1/objects/prefs', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'If-None-Match': '*',
      'Content-Type': 'application/octet-stream',
      'X-Object-Kind': 'prefs',
    },
    body: new Uint8Array([1, 2, 3]),
  }), workerEnv);
  assert.equal(put.status, 200);

  const get = await handle(req('/v1/objects/prefs', {
    headers: { Authorization: `Bearer ${TOKEN}` },
  }), workerEnv);
  assert.equal(get.status, 200);
  assert.equal(get.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(get.headers.get('Last-Modified'), null);
  assert.ok(get.headers.get('ETag'));
  assert.equal(get.headers.get('Access-Control-Allow-Origin'), ORIGIN);
});

test('PUT prefs If-None-Match * 412s when the object already exists', async () => {
  const workerEnv = env();
  const first = await handle(req('/v1/objects/prefs', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'If-None-Match': '*',
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array([1]),
  }), workerEnv);
  assert.equal(first.status, 200);

  const second = await handle(req('/v1/objects/prefs', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'If-None-Match': '*',
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array([2]),
  }), workerEnv);
  assert.equal(second.status, 412);
  assert.equal(second.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  const body = await second.json();
  assert.equal(body.error, 'precondition failed');
  assert.ok(body.etag);
});

test('DELETE /v1/objects/project-x removes the canvas object', async () => {
  const workerEnv = env();
  const put = await handle(req('/v1/objects/project-x', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'If-None-Match': '*',
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array([1]),
  }), workerEnv);
  assert.equal(put.status, 200);

  const del = await handle(req('/v1/objects/project-x', {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}` },
  }), workerEnv);
  assert.equal(del.status, 200);
  assert.equal(del.headers.get('Access-Control-Allow-Origin'), ORIGIN);

  const gone = await handle(req('/v1/objects/project-x', {
    headers: { Authorization: `Bearer ${TOKEN}` },
  }), workerEnv);
  assert.equal(gone.status, 404);
});

test('PUT prefs If-Match 412s on a stale etag', async () => {
  const workerEnv = env();
  const first = await handle(req('/v1/objects/prefs', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'If-None-Match': '*',
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array([1]),
  }), workerEnv);
  assert.equal(first.status, 200);

  const stale = await handle(req('/v1/objects/prefs', {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'If-Match': 'not-the-etag',
      'Content-Type': 'application/octet-stream',
    },
    body: new Uint8Array([2]),
  }), workerEnv);
  assert.equal(stale.status, 412);
});

test('POST /api/probe-models is the proxy, not the vault', async () => {
  const res = await handle(req('/api/probe-models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  }));
  assert.notEqual(res.status, 401);
  assert.equal(res.status, 400);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.deepEqual(await res.json(), { error: 'baseURL required' });
});

test('OPTIONS /api/probe-models allows POST from Pages', async () => {
  const res = await handle(req('/api/probe-models', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  }));
  assert.equal(res.status, 204);
  assert.ok(headerList(res, 'Access-Control-Allow-Methods').includes('post'));
});
