import { useStore, stripTransient } from '../store';
import {
  useProjects, registerProject, deleteProject,
  loadProjectState, saveProjectState,
} from '../store/projects';
import { decideProjectSync, projectHashSource } from './sync-decision';
import { flushPendingWrites } from './persistence';
import { internNodes } from './attachment-vault';
import { toast, useUiStore } from './ui-store';
import { storedProviders, saveProviders, type RuntimeProvider } from './runtime-providers';
import { t, fmt, useI18n } from '../i18n';
import { isViewerMode } from './viewer';
import type { ThoughtNode, ThoughtEdge, CanvasEvent } from '../types';

// Optional remote vault: the user pastes a Worker URL and invents a
// storage-area name. Snapshots are encrypted in the browser (AES-GCM);
// the worker only stores blobs. Same URL + same name = the same vault.
// Conflicts never merge DAGs — the remote copy keeps the shared id, the
// local work is forked as "name (conflict)".

const ENDPOINT_KEY = 'thoughtdag.sync.endpoint';
const AREA_KEY = 'thoughtdag.sync.area';
const LEGACY_AREA_KEY = 'thoughtdag.sync.secret';
const RECORDS_KEY = 'thoughtdag.sync.records';
const PREFS_RECORD_KEY = 'thoughtdag.sync.prefsHash';
const LAST_AT_KEY = 'thoughtdag.sync.lastAt';
const AUTH_PREFIX = 'thoughtdag-sync-auth-v1:';
const HKDF_SALT = 'thoughtdag-sync-v1';
const DEBOUNCE_MS = 60_000;
const PREFS_KEY = 'prefs';
const projectObjectKey = (id: string) => `project-${id}`;

export interface SyncConfig {
  endpoint: string;
  area: string;
}

export interface SyncObjectInfo {
  key: string;
  size: number;
  etag: string;
  updatedAt?: string;
  name?: string;
  hash?: string;
  kind?: string;
}

interface PushRecord { hash: string; updatedAt: number }
interface GraphState { nodes: ThoughtNode[]; edges: ThoughtEdge[]; events?: CanvasEvent[] }

interface ProjectSnapshot {
  version: 1;
  kind: 'project';
  id: string;
  name: string;
  projectKind?: 'chat' | 'paradigm';
  createdAt: number;
  updatedAt: number;
  instantiatedFrom?: { name: string; at: string };
  hash: string;
  nodes: ThoughtNode[];
  edges: ThoughtEdge[];
  events?: CanvasEvent[];
}

interface PrefsSnapshot {
  version: 1;
  kind: 'prefs';
  updatedAt: number;
  hash: string;
  selectedModel: string | null;
  webSearchEnabled: boolean;
  scholarSearchEnabled: boolean;
  visionModelPref: string;
  searchEnginePref: string;
  memoryEnabled: boolean;
  memories: unknown[];
  roleLib: unknown;
  advancedMode: boolean;
  lang: string;
  anysearchKey?: string;
  /** Full provider records, keys included. The envelope is encrypted with
      the storage-area name before it leaves the browser. */
  providers: RuntimeProvider[];
}

export function loadSyncConfig(): SyncConfig | null {
  const endpoint = (localStorage.getItem(ENDPOINT_KEY) || '').replace(/\/+$/, '');
  const area = localStorage.getItem(AREA_KEY) || localStorage.getItem(LEGACY_AREA_KEY) || '';
  if (!endpoint || !area) return null;
  return { endpoint, area };
}

export function saveSyncConfig(cfg: SyncConfig | null): void {
  if (!cfg) {
    localStorage.removeItem(ENDPOINT_KEY);
    localStorage.removeItem(AREA_KEY);
    localStorage.removeItem(LEGACY_AREA_KEY);
    localStorage.removeItem(RECORDS_KEY);
    localStorage.removeItem(PREFS_RECORD_KEY);
    localStorage.removeItem(LAST_AT_KEY);
    useUiStore.getState().setLastRemoteSyncAt(null);
    return;
  }
  localStorage.setItem(ENDPOINT_KEY, cfg.endpoint.replace(/\/+$/, ''));
  localStorage.setItem(AREA_KEY, cfg.area);
  localStorage.removeItem(LEGACY_AREA_KEY);
}

/** Keep the last-known hash after the local canvas is gone, so the next
    sync can DELETE the vault object instead of pulling it back. */
export function rememberDeletedProject(id: string): void {
  if (!loadSyncConfig()) return;
  const rec = loadRecords()[id];
  if (!rec) saveRecord(id, { hash: 'deleted', updatedAt: Date.now() });
  scheduleRemoteSync({ soon: true });
}

export function lastRemoteSyncAt(): number | null {
  const raw = localStorage.getItem(LAST_AT_KEY);
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}

function markSynced(): void {
  const now = Date.now();
  localStorage.setItem(LAST_AT_KEY, String(now));
  useUiStore.getState().setLastRemoteSyncAt(now);
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function deriveMaterial(area: string): Promise<{ authToken: string; encKey: CryptoKey }> {
  const enc = new TextEncoder();
  const authToken = await sha256Hex(AUTH_PREFIX + area);
  const material = await crypto.subtle.importKey('raw', enc.encode(area), 'HKDF', false, ['deriveKey']);
  const encKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode('enc') },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { authToken, encKey };
}

async function encryptJson(key: CryptoKey, value: unknown): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(JSON.stringify(value));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt));
  const out = new Uint8Array(3 + 12 + ct.length);
  out.set(new TextEncoder().encode('TD1'), 0);
  out.set(iv, 3);
  out.set(ct, 15);
  return out;
}

async function decryptJson(key: CryptoKey, bytes: ArrayBuffer): Promise<unknown> {
  const buf = new Uint8Array(bytes);
  if (buf.length < 16 || buf[0] !== 0x54 || buf[1] !== 0x44 || buf[2] !== 0x31) {
    throw new Error('unrecognized vault envelope');
  }
  const iv = buf.slice(3, 15);
  const ct = buf.slice(15);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return JSON.parse(new TextDecoder().decode(pt));
}

function loadRecords(): Record<string, PushRecord> {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECORDS_KEY) || '{}') as Record<string, PushRecord>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function saveRecord(id: string, rec: PushRecord): void {
  const all = loadRecords();
  all[id] = rec;
  localStorage.setItem(RECORDS_KEY, JSON.stringify(all));
}

function dropRecord(id: string): void {
  const all = loadRecords();
  if (!(id in all)) return;
  delete all[id];
  localStorage.setItem(RECORDS_KEY, JSON.stringify(all));
}

async function api(
  endpoint: string,
  authToken: string,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${authToken}`);
  headers.set('Cache-Control', 'no-cache');
  const res = await fetch(`${endpoint}${path}`, { ...init, headers, cache: 'no-store' });
  return res;
}

function decodeHeaderName(raw: string | null): string | undefined {
  if (!raw) return undefined;
  try { return decodeURIComponent(raw); } catch { return raw; }
}

async function listObjects(endpoint: string, authToken: string): Promise<SyncObjectInfo[]> {
  const res = await api(endpoint, authToken, '/v1/objects');
  if (!res.ok) throw new Error(await errorFrom(res));
  const body = await res.json() as { objects?: SyncObjectInfo[] };
  return body.objects ?? [];
}

async function getObject(endpoint: string, authToken: string, key: string): Promise<{ bytes: ArrayBuffer; etag: string; meta: SyncObjectInfo }> {
  const res = await api(endpoint, authToken, `/v1/objects/${encodeURIComponent(key)}`);
  if (!res.ok) throw new Error(await errorFrom(res));
  return {
    bytes: await res.arrayBuffer(),
    etag: (res.headers.get('ETag') || '').replaceAll('"', ''),
    meta: {
      key,
      size: Number(res.headers.get('Content-Length') || 0),
      etag: (res.headers.get('ETag') || '').replaceAll('"', ''),
      updatedAt: res.headers.get('X-Object-Updated-At') || undefined,
      name: decodeHeaderName(res.headers.get('X-Object-Name')),
      hash: res.headers.get('X-Object-Hash') || undefined,
      kind: res.headers.get('X-Object-Kind') || undefined,
    },
  };
}

async function putObject(
  endpoint: string,
  authToken: string,
  key: string,
  body: Uint8Array,
  meta: { name?: string; updatedAt?: string; hash?: string; kind?: string },
  etag?: string,
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
  if (meta.updatedAt) headers['X-Object-Updated-At'] = meta.updatedAt;
  if (meta.hash) headers['X-Object-Hash'] = meta.hash;
  if (meta.kind) headers['X-Object-Kind'] = meta.kind;
  if (etag) headers['If-Match'] = etag;
  else headers['If-None-Match'] = '*';
  const qs = meta.name ? `?name=${encodeURIComponent(meta.name)}` : '';
  const res = await api(endpoint, authToken, `/v1/objects/${encodeURIComponent(key)}${qs}`, {
    method: 'PUT',
    headers,
    body: body as unknown as BodyInit,
  });
  if (res.status === 412) {
    const err = new Error('precondition failed');
    (err as Error & { code: string }).code = 'precondition';
    throw err;
  }
  if (!res.ok) throw new Error(await errorFrom(res));
  const json = await res.json() as { etag?: string };
  return json.etag || '';
}

async function deleteRemoteObject(endpoint: string, authToken: string, key: string): Promise<void> {
  const res = await api(endpoint, authToken, `/v1/objects/${encodeURIComponent(key)}`, { method: 'DELETE' });
  if (res.status === 404) return;
  if (!res.ok) throw new Error(await errorFrom(res));
}

async function errorFrom(res: Response): Promise<string> {
  try {
    const body = await res.json() as { error?: string };
    return body.error || `HTTP ${res.status}`;
  } catch {
    return `HTTP ${res.status}`;
  }
}

function slimAttachments(nodes: ThoughtNode[]): ThoughtNode[] {
  return nodes.map((n) => ({
    ...n,
    selected: false,
    data: {
      ...n.data,
      attachments: (n.data.attachments ?? []).map((a) => ({
        ...a,
        content: a.type.startsWith('image/') || a.type === 'application/pdf' ? '' : a.content,
        contentInVault: undefined,
        pageImages: undefined,
        isExtracting: false,
      })),
    },
  }));
}

async function hashPayload(value: unknown): Promise<string> {
  return sha256Hex(JSON.stringify(value));
}

async function readLocalGraph(id: string): Promise<GraphState | null> {
  const { activeId } = useProjects.getState();
  if (id === activeId) {
    await flushPendingWrites();
    const { nodes, edges, events } = useStore.getState();
    return { nodes: stripTransient(nodes), edges, events };
  }
  const stored = await loadProjectState(id);
  if (!stored) return null;
  return { nodes: stripTransient(stored.nodes), edges: stored.edges, events: stored.events ?? [] };
}

function hasContent(graph: GraphState | null): boolean {
  return !!graph && graph.nodes.length > 0;
}

async function applyGraph(id: string, snap: ProjectSnapshot): Promise<void> {
  const nodes = await internNodes(stripTransient(snap.nodes));
  const edges = snap.edges;
  const events = snap.events ?? [];
  const { activeId } = useProjects.getState();
  if (id === activeId) {
    await flushPendingWrites();
    useStore.setState({
      nodes, edges, events,
      history: [{ nodes, edges }],
      historyIndex: 0,
      selectedNodeId: null,
      selectedNodeIds: [],
    });
  } else {
    await saveProjectState(id, { nodes, edges, events });
  }
  await registerProject(id, snap.name, snap.projectKind ?? 'chat', {
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
    instantiatedFrom: snap.instantiatedFrom,
  });
}

async function forkLocalConflict(local: GraphState, name: string, kind?: 'chat' | 'paradigm'): Promise<string> {
  const forkId = crypto.randomUUID();
  await saveProjectState(forkId, local);
  await registerProject(forkId, `${name} (conflict)`, kind ?? 'chat', { updatedAt: Date.now() });
  return forkId;
}

async function keepRemoteAndForkLocal(
  endpoint: string,
  authToken: string,
  encKey: CryptoKey,
  id: string,
  local: GraphState,
  name: string,
  kind: 'chat' | 'paradigm' | undefined,
  localHash: string,
): Promise<'conflict'> {
  const forkId = await forkLocalConflict(local, name, kind);
  await pullProject(endpoint, authToken, encKey, id);
  toast('info', fmt(t('sync.conflictForked'), { name, fork: `${name} (conflict)` }), 9000);
  saveRecord(forkId, { hash: localHash, updatedAt: Date.now() });
  return 'conflict';
}

function collectPrefs(): Omit<PrefsSnapshot, 'hash'> {
  const ui = useUiStore.getState();
  return {
    version: 1,
    kind: 'prefs',
    updatedAt: Date.now(),
    selectedModel: ui.selectedModel,
    webSearchEnabled: ui.webSearchEnabled,
    scholarSearchEnabled: ui.scholarSearchEnabled,
    visionModelPref: ui.visionModelPref,
    searchEnginePref: ui.searchEnginePref,
    memoryEnabled: ui.memoryEnabled,
    memories: ui.memories,
    roleLib: ui.roleLib,
    advancedMode: ui.advancedMode,
    lang: useI18n.getState().lang,
    anysearchKey: ui.anysearchKey,
    providers: storedProviders(),
  };
}

function applyPrefs(snap: PrefsSnapshot): void {
  const ui = useUiStore.getState();
  ui.setSelectedModel(snap.selectedModel);
  ui.setWebSearchEnabled(snap.webSearchEnabled);
  ui.setScholarSearchEnabled(snap.scholarSearchEnabled);
  ui.setVisionModelPref(snap.visionModelPref);
  ui.setSearchEnginePref(snap.searchEnginePref);
  ui.setMemoryEnabled(snap.memoryEnabled);
  if (Array.isArray(snap.memories)) ui.setMemories(snap.memories as typeof ui.memories);
  if (snap.roleLib && typeof snap.roleLib === 'object') ui.setRoleLib(snap.roleLib as typeof ui.roleLib);
  ui.setAdvancedMode(!!snap.advancedMode);
  if (snap.lang === 'en' || snap.lang === 'zh') useI18n.getState().setLang(snap.lang);
  if (typeof snap.anysearchKey === 'string') ui.setAnysearchKey(snap.anysearchKey);
  const local = storedProviders();
  const merged: RuntimeProvider[] = (snap.providers ?? []).map((remote) => {
    const hit = local.find((p) => p.baseURL === remote.baseURL);
    // A newer snapshot may still lack keys (older clients). Keep the local
    // key rather than wiping a working connection.
    return { ...remote, apiKey: remote.apiKey || hit?.apiKey || '' };
  });
  for (const leftover of local) {
    if (!merged.some((p) => p.baseURL === leftover.baseURL)) merged.push(leftover);
  }
  saveProviders(merged);
}

export async function testSyncConnection(cfg: SyncConfig): Promise<void> {
  if (cfg.area.trim().length < 8) throw new Error(t('sync.secretTooShort'));
  const endpoint = cfg.endpoint.replace(/\/+$/, '');
  const health = await fetch(`${endpoint}/v1/health`);
  if (!health.ok) throw new Error(`health ${health.status}`);
  const { authToken } = await deriveMaterial(cfg.area);
  const res = await api(endpoint, authToken, '/v1/objects');
  if (res.status === 401) throw new Error('unauthorized');
  if (!res.ok) throw new Error(await errorFrom(res));
}

export async function syncNow(opts: { silent?: boolean } = {}): Promise<{ pulled: number; pushed: number; conflicts: number; deleted: number } | null> {
  if (isViewerMode) return null;
  const cfg = loadSyncConfig();
  if (!cfg) return null;
  const { authToken, encKey } = await deriveMaterial(cfg.area);
  const remote = await listObjects(cfg.endpoint, authToken);
  let pulled = 0;
  let pushed = 0;
  let conflicts = 0;
  let deleted = 0;

  pulled += await syncPrefs(cfg.endpoint, authToken, encKey, remote);

  const remoteProjects = remote.filter((o) => o.key.startsWith('project-'));
  const remoteIds = new Set(remoteProjects.map((o) => o.key.slice('project-'.length)));
  const localProjects = useProjects.getState().projects;

  for (const info of remoteProjects) {
    const id = info.key.slice('project-'.length);
    const result = await syncProject(cfg.endpoint, authToken, encKey, id, info);
    if (result === 'pull') pulled += 1;
    if (result === 'push') pushed += 1;
    if (result === 'conflict') conflicts += 1;
    if (result === 'deleted') deleted += 1;
  }

  const localIds = new Set(localProjects.map((p) => p.id));
  for (const project of localProjects) {
    if (remoteIds.has(project.id)) continue;
    const result = await syncLocalOnly(cfg.endpoint, authToken, encKey, project.id);
    if (result === 'push') pushed += 1;
    if (result === 'deleted') deleted += 1;
  }

  // Tombstones for canvases deleted here that never existed in the vault.
  for (const id of Object.keys(loadRecords())) {
    if (!remoteIds.has(id) && !localIds.has(id)) dropRecord(id);
  }

  markSynced();
  if (!opts.silent) {
    if (conflicts > 0) toast('info', fmt(t('sync.doneConflict'), { pulled, pushed, conflicts }), 8000);
    else if (deleted > 0) toast('success', fmt(t('sync.doneDeleted'), { pulled, pushed, deleted }));
    else toast('success', fmt(t('sync.done'), { pulled, pushed }));
  }
  return { pulled, pushed, conflicts, deleted };
}

async function syncPrefs(
  endpoint: string,
  authToken: string,
  encKey: CryptoKey,
  remote: SyncObjectInfo[],
): Promise<number> {
  const local = collectPrefs();
  const localHash = await hashPayload({ ...local, updatedAt: 0, hash: undefined });
  const last = localStorage.getItem(PREFS_RECORD_KEY);
  const info = remote.find((o) => o.key === PREFS_KEY);
  if (!info) {
    await putPrefs(endpoint, authToken, encKey, local, localHash);
    localStorage.setItem(PREFS_RECORD_KEY, localHash);
    return 0;
  }
  if (info.hash && info.hash === localHash) {
    localStorage.setItem(PREFS_RECORD_KEY, localHash);
    return 0;
  }
  const obj = await getObject(endpoint, authToken, PREFS_KEY);
  const snap = await decryptJson(encKey, obj.bytes) as PrefsSnapshot;
  const remoteHash = snap.hash || info.hash || '';
  // First link on this computer: adopt the vault. Treating "no last hash"
  // as a local edit would push factory defaults over the other machine.
  if (!last) {
    applyPrefs(snap);
    localStorage.setItem(PREFS_RECORD_KEY, remoteHash);
    return 1;
  }
  const localChanged = last !== localHash;
  const remoteChanged = last !== remoteHash;
  if (!localChanged && remoteChanged) {
    applyPrefs(snap);
    localStorage.setItem(PREFS_RECORD_KEY, remoteHash);
    return 1;
  }
  // Local wins prefs on conflict, keys included. The other computer will
  // pick them up on the next pull.
  await putPrefs(endpoint, authToken, encKey, local, localHash, obj.etag);
  localStorage.setItem(PREFS_RECORD_KEY, localHash);
  return 0;
}

async function putPrefs(
  endpoint: string,
  authToken: string,
  encKey: CryptoKey,
  local: Omit<PrefsSnapshot, 'hash'>,
  localHash: string,
  etag?: string,
): Promise<void> {
  const bytes = await encryptJson(encKey, { ...local, hash: localHash });
  const meta = { kind: 'prefs', hash: localHash, updatedAt: new Date(local.updatedAt).toISOString() };
  try {
    await putObject(endpoint, authToken, PREFS_KEY, bytes, meta, etag);
  } catch (err) {
    // A disk-cached GET (or a racing writer) leaves us with a stale
    // etag / a false "object missing". One live GET + retry is enough.
    if ((err as { code?: string }).code !== 'precondition') throw err;
    const fresh = await getObject(endpoint, authToken, PREFS_KEY);
    await putObject(endpoint, authToken, PREFS_KEY, bytes, meta, fresh.etag);
  }
}

async function localHashOf(graph: GraphState | null, name: string): Promise<string> {
  if (!graph) return '';
  return hashPayload(projectHashSource({
    nodes: slimAttachments(graph.nodes),
    edges: graph.edges,
    events: graph.events ?? [],
  }, name));
}

async function syncProject(
  endpoint: string,
  authToken: string,
  encKey: CryptoKey,
  id: string,
  info: SyncObjectInfo,
): Promise<'pull' | 'push' | 'conflict' | 'same' | 'deleted'> {
  const localMeta = useProjects.getState().projects.find((p) => p.id === id);
  const graph = await readLocalGraph(id);
  const localHash = await localHashOf(graph, localMeta?.name ?? '');
  const last = loadRecords()[id];
  let remoteHash = info.hash || '';
  if (!remoteHash) {
    try {
      const obj = await getObject(endpoint, authToken, projectObjectKey(id));
      const snap = await decryptJson(encKey, obj.bytes) as ProjectSnapshot;
      remoteHash = snap.hash || '';
    } catch { /* list entry without a readable body: treat hash as unknown */ }
  }
  const action = decideProjectSync({
    localExists: !!localMeta,
    remoteExists: true,
    localHasContent: hasContent(graph),
    lastHash: last?.hash ?? null,
    localHash,
    remoteHash,
  });

  if (action === 'same') {
    if (localHash) saveRecord(id, { hash: localHash, updatedAt: localMeta?.updatedAt ?? Date.now() });
    return 'same';
  }
  if (action === 'delete-remote') {
    await deleteRemoteObject(endpoint, authToken, projectObjectKey(id));
    dropRecord(id);
    return 'deleted';
  }
  if (action === 'pull') {
    await pullProject(endpoint, authToken, encKey, id);
    return 'pull';
  }
  if (action === 'conflict') {
    return keepRemoteAndForkLocal(endpoint, authToken, encKey, id, graph!, localMeta?.name || 'canvas', localMeta?.kind, localHash);
  }
  try {
    await pushProject(endpoint, authToken, encKey, id, info.etag);
    return 'push';
  } catch (err) {
    if ((err as { code?: string }).code !== 'precondition') throw err;
    return keepRemoteAndForkLocal(endpoint, authToken, encKey, id, graph!, localMeta?.name || 'canvas', localMeta?.kind, localHash);
  }
}

async function syncLocalOnly(
  endpoint: string,
  authToken: string,
  encKey: CryptoKey,
  id: string,
): Promise<'push' | 'same' | 'deleted'> {
  const graph = await readLocalGraph(id);
  const name = useProjects.getState().projects.find((p) => p.id === id)?.name ?? '';
  const localHash = await localHashOf(graph, name);
  const last = loadRecords()[id];
  const action = decideProjectSync({
    localExists: true,
    remoteExists: false,
    localHasContent: hasContent(graph),
    lastHash: last?.hash ?? null,
    localHash,
    remoteHash: '',
  });
  if (action === 'delete-local') {
    await deleteProject(id, { propagate: false });
    dropRecord(id);
    return 'deleted';
  }
  if (action === 'push') {
    await pushProject(endpoint, authToken, encKey, id, undefined);
    return 'push';
  }
  return 'same';
}

async function pullProject(endpoint: string, authToken: string, encKey: CryptoKey, id: string): Promise<void> {
  const obj = await getObject(endpoint, authToken, projectObjectKey(id));
  const snap = await decryptJson(encKey, obj.bytes) as ProjectSnapshot;
  if (!snap || snap.kind !== 'project' || !Array.isArray(snap.nodes)) throw new Error('bad project snapshot');
  await applyGraph(id, snap);
  saveRecord(id, { hash: snap.hash, updatedAt: snap.updatedAt });
}

async function pushProject(
  endpoint: string,
  authToken: string,
  encKey: CryptoKey,
  id: string,
  etag?: string,
): Promise<void> {
  const meta = useProjects.getState().projects.find((p) => p.id === id);
  const graph = await readLocalGraph(id);
  if (!graph || !meta) return;
  const nodes = slimAttachments(graph.nodes);
  const hash = await hashPayload(projectHashSource({
    nodes, edges: graph.edges, events: graph.events ?? [],
  }, meta.name));
  const snap: ProjectSnapshot = {
    version: 1,
    kind: 'project',
    id,
    name: meta.name,
    projectKind: meta.kind,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    instantiatedFrom: meta.instantiatedFrom,
    hash,
    nodes,
    edges: graph.edges,
    events: graph.events,
  };
  const bytes = await encryptJson(encKey, snap);
  await putObject(endpoint, authToken, projectObjectKey(id), bytes, {
    name: meta.name,
    updatedAt: new Date(meta.updatedAt).toISOString(),
    hash,
    kind: 'project',
  }, etag);
  saveRecord(id, { hash, updatedAt: meta.updatedAt });
}

let timer: ReturnType<typeof setTimeout> | null = null;
let watching = false;

const DELETE_DEBOUNCE_MS = 1500;

export function scheduleRemoteSync(opts?: { soon?: boolean }): void {
  if (!loadSyncConfig()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    void syncNow({ silent: true }).catch((err) => {
      console.warn('[thoughtdag] remote sync failed:', err);
    });
  }, opts?.soon ? DELETE_DEBOUNCE_MS : DEBOUNCE_MS);
}

export function bootRemoteSync(): void {
  if (isViewerMode) return;
  const last = lastRemoteSyncAt();
  if (last) useUiStore.getState().setLastRemoteSyncAt(last);
  if (!loadSyncConfig()) return;
  if (!watching) {
    watching = true;
    useStore.subscribe((state, prev) => {
      if (state.nodes !== prev.nodes || state.edges !== prev.edges) scheduleRemoteSync();
    });
  }
  void syncNow({ silent: true }).catch((err) => {
    console.warn('[thoughtdag] remote sync boot failed:', err);
    toast('error', fmt(t('sync.failed'), { error: err instanceof Error ? err.message : String(err) }));
  });
}
