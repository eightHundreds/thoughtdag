// ThoughtDAG hosted backend: the demo LLM proxy PLUS an R2 sync vault.
//
//   /api/*     — same stateless BYOK proxy as app.thoughtdag.workers.dev
//                (probe models, stream, scholar search, link snapshots).
//   /v1/*      — encrypted object store. The Bearer token IS the vault
//                name; each distinct token is its own R2 prefix.
//
// The worker never inspects vault bodies. Clients encrypt before PUT.
import { onRequest } from '../../../functions/api/[[path]].js';

const NS_PREFIX = 'thoughtdag-sync-ns-v1:';
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_OBJECTS = 200;
const KEY_RE = /^[A-Za-z0-9._-]{1,128}$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json(request, { ok: true, service: 'thoughtdag-proxy' });
    }
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice('/api/'.length);
      const res = await onRequest({ request, params: { path: path.split('/') }, env });
      return withCors(request, res);
    }
    try {
      return await handle(request, env, url);
    } catch (err) {
      return json(request, { error: err.message || 'internal error' }, 500);
    }
  },
};

async function handle(request, env, url) {
  if (request.method === 'GET' && url.pathname === '/v1/health') {
    return json(request, { ok: true, service: 'thoughtdag-sync' });
  }

  const ns = await authorize(request, env);
  if (!ns) return json(request, { error: 'unauthorized' }, 401);
  if (!env.BUCKET) return json(request, { error: 'bucket not bound' }, 503);

  const objectsRoot = '/v1/objects';
  if (url.pathname === objectsRoot || url.pathname === `${objectsRoot}/`) {
    if (request.method !== 'GET') return json(request, { error: 'method not allowed' }, 405);
    return listObjects(request, env, ns);
  }

  if (!url.pathname.startsWith(`${objectsRoot}/`)) {
    return json(request, { error: 'not found' }, 404);
  }
  const key = decodeURIComponent(url.pathname.slice(objectsRoot.length + 1));
  if (!KEY_RE.test(key)) return json(request, { error: 'invalid object key' }, 400);

  const r2Key = `${ns}/${key}`;
  if (request.method === 'GET' || request.method === 'HEAD') return getObject(request, env, r2Key);
  if (request.method === 'PUT') return putObject(request, env, ns, key, r2Key);
  if (request.method === 'DELETE') return deleteObject(request, env, r2Key);
  return json(request, { error: 'method not allowed' }, 405);
}

async function listObjects(request, env, ns) {
  const objects = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: `${ns}/`, cursor, include: ['customMetadata', 'httpMetadata'] });
    for (const obj of page.objects) {
      const key = obj.key.slice(ns.length + 1);
      if (!key || key.includes('/')) continue;
      objects.push(describe(obj, key));
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return json(request, { objects });
}

async function getObject(request, env, r2Key) {
  const obj = await env.BUCKET.get(r2Key);
  if (!obj) return json(request, { error: 'not found' }, 404);
  const headers = objectHeaders(request, obj);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  return new Response(obj.body, { status: 200, headers });
}

async function putObject(request, env, ns, key, r2Key) {
  const ifMatch = request.headers.get('If-Match');
  const ifNoneMatch = request.headers.get('If-None-Match');
  const existing = await env.BUCKET.head(r2Key);
  if (ifNoneMatch === '*' && existing) {
    return json(request, { error: 'precondition failed', etag: stripEtag(existing.httpEtag) }, 412);
  }
  if (ifMatch) {
    if (!existing) return json(request, { error: 'precondition failed' }, 412);
    if (!etagMatches(ifMatch, existing.httpEtag)) {
      return json(request, { error: 'precondition failed', etag: stripEtag(existing.httpEtag) }, 412);
    }
  }

  const buf = await request.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) {
    return json(request, { error: `object exceeds ${MAX_BYTES} bytes` }, 413);
  }
  if (!existing) {
    const listed = await env.BUCKET.list({ prefix: `${ns}/` });
    if (listed.objects.length >= MAX_OBJECTS) {
      return json(request, { error: `namespace exceeds ${MAX_OBJECTS} objects` }, 409);
    }
  }

  const customMetadata = {};
  const name = request.headers.get('X-Object-Name');
  const updatedAt = request.headers.get('X-Object-Updated-At');
  const hash = request.headers.get('X-Object-Hash');
  const kind = request.headers.get('X-Object-Kind');
  if (name) customMetadata.name = name.slice(0, 200);
  if (updatedAt) customMetadata.updatedAt = updatedAt.slice(0, 40);
  if (hash) customMetadata.hash = hash.slice(0, 80);
  if (kind) customMetadata.kind = kind.slice(0, 40);

  const written = await env.BUCKET.put(r2Key, buf, {
    httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' },
    customMetadata,
    ...(ifMatch && existing ? { onlyIf: { etagMatches: stripEtag(existing.httpEtag) } } : {}),
  });
  if (written === null) return json(request, { error: 'precondition failed' }, 412);
  return json(request, { ok: true, key, etag: stripEtag(written.httpEtag), size: buf.byteLength });
}

async function deleteObject(request, env, r2Key) {
  const existing = await env.BUCKET.head(r2Key);
  if (!existing) return json(request, { error: 'not found' }, 404);
  await env.BUCKET.delete(r2Key);
  return json(request, { ok: true });
}

function describe(obj, key) {
  const meta = obj.customMetadata || {};
  return {
    key,
    size: obj.size,
    etag: stripEtag(obj.httpEtag),
    updatedAt: meta.updatedAt || (obj.uploaded ? new Date(obj.uploaded).toISOString() : undefined),
    name: meta.name,
    hash: meta.hash,
    kind: meta.kind,
  };
}

function objectHeaders(request, obj) {
  const meta = obj.customMetadata || {};
  return {
    ...corsHeaders(request),
    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
    // ETag stays for If-Match. Last-Modified is omitted so browsers and
    // local proxies do not heuristic-cache a vault blob and hand a stale
    // etag to the next PUT (412 Precondition Failed).
    ETag: obj.httpEtag,
    'Cache-Control': 'private, no-store',
    Pragma: 'no-cache',
    'X-Object-Name': meta.name || '',
    'X-Object-Updated-At': meta.updatedAt || '',
    'X-Object-Hash': meta.hash || '',
    'X-Object-Kind': meta.kind || '',
  };
}

async function authorize(request, _env) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(\S+)/i);
  if (!match) return null;
  const presented = match[1];
  // Short names are too easy to collide with; the app hashes the user's
  // vault name to 64 hex chars before sending. Accept that, or any other
  // 32+ char token typed as a raw namespace id.
  if (presented.length < 32) return null;
  return sha256Hex(NS_PREFIX + presented);
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match, If-None-Match, X-Object-Name, X-Object-Updated-At, X-Object-Hash, X-Object-Kind',
    'Access-Control-Expose-Headers': 'ETag, Last-Modified, X-Object-Name, X-Object-Updated-At, X-Object-Hash, X-Object-Kind',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(request, body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(request),
      'Content-Type': 'application/json',
      'Cache-Control': 'private, no-store',
      Pragma: 'no-cache',
    },
  });
}

function withCors(request, res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(corsHeaders(request))) {
    if (v) headers.set(k, v);
  }
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function stripEtag(etag) {
  return String(etag || '').replaceAll('"', '');
}

function etagMatches(ifMatch, httpEtag) {
  const have = stripEtag(httpEtag);
  return ifMatch.split(',').map((part) => stripEtag(part.trim())).some((part) => part === have || part === '*');
}

async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
