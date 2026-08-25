// Pure catalog helpers — no DOM, no fetch. The hosted app builds the model
// list in the browser; the Worker is no longer asked to echo it back.

export interface CatalogModel {
  id: string;
  name: string;
  provider: string;
  vision: boolean;
}

export interface CatalogData {
  models: CatalogModel[];
  default: string | null;
  capabilities: {
    webSearch: boolean;
    searchEngine: string;
    anysearch: boolean;
    scholarSearch: boolean;
    vision: boolean;
  };
}

export interface ProbeModel {
  id: string;
  vision?: boolean;
  created?: number;
  contextLength?: number;
}

const GLM_SEARCH_HOSTS = ['open.bigmodel.cn', 'api.z.ai'];

export const isOpenRouterURL = (baseURL: string) => /openrouter\.ai/i.test(baseURL);

/** Local runtimes (Ollama, ChatGPT plan bridge) typically have no CORS. */
export function isLoopbackURL(baseURL: string): boolean {
  try {
    const h = new URL(baseURL).hostname;
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
  } catch {
    return false;
  }
}

export function providerHasGlmSearch(providers: { baseURL?: string; apiKey?: string }[]): boolean {
  return providers.some((p) =>
    !!p.apiKey && GLM_SEARCH_HOSTS.some((h) => String(p.baseURL ?? '').includes(h)));
}

// Vision families recognizable from the id alone. Only OpenRouter's /models
// route ships modality metadata; every other provider answers with bare ids.
// The hint only ever ADDS vision — metadata, when present, always wins.
export const VISION_ID_HINT = /gemini|gpt-4o|gpt-4\.1|gpt-5|claude|glm-4v|qwen[\w.-]*-vl|qvq|llava|pixtral|minicpm-v|internvl|kimi-latest|-vision|vision-/i;

export function decorateVision<T extends { id: string; vision?: boolean }>(models: T[]): T[] {
  for (const m of models) {
    if (m.vision === undefined && VISION_ID_HINT.test(m.id)) m.vision = true;
  }
  return models;
}

export function parseProbePayload(data: unknown): ProbeModel[] {
  const rec = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const list = Array.isArray(rec.data) ? rec.data : Array.isArray(rec.models) ? rec.models : [];
  return list.map((raw) => {
    const m = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const arch = m.architecture && typeof m.architecture === 'object'
      ? m.architecture as { input_modalities?: string[] }
      : undefined;
    const id = String(m.id ?? m.name ?? '').replace(/^models\//, '');
    return {
      id,
      ...(typeof m.created === 'number' ? { created: m.created } : {}),
      ...(arch?.input_modalities ? { vision: arch.input_modalities.includes('image') } : {}),
      ...(typeof m.context_length === 'number' ? { contextLength: m.context_length } : {}),
    };
  }).filter((m) => m.id);
}

/** Browser-stored providers talk to the gateway from the page — hosted
    and local. Models that exist only in a local .env have no entry here
    and still ride the Node proxy. */
export function pickDirectProvider<T extends { models: { id: string }[] }>(
  modelId: string | undefined,
  providers: T[],
): T | null {
  if (!modelId) return null;
  return providers.find((p) => p.models.some((m) => m.id === modelId)) ?? null;
}

export function catalogFromProviders(
  providers: { name?: string; baseURL?: string; apiKey?: string; models?: { id: string; vision?: boolean }[] }[],
  anysearchKey?: string,
): CatalogData {
  const models: CatalogModel[] = [];
  let hasOpenRouter = false;
  for (const p of (Array.isArray(providers) ? providers : []).slice(0, 12)) {
    const name = String(p.name || 'Custom').slice(0, 40);
    if (isOpenRouterURL(String(p.baseURL ?? ''))) hasOpenRouter = true;
    for (const m of (Array.isArray(p.models) ? p.models : []).slice(0, 60)) {
      if (!m?.id || models.some((x) => x.id === m.id)) continue;
      const shortId = m.id.includes('/') ? m.id.split('/').slice(1).join('/') : m.id;
      models.push({
        id: m.id,
        name: `${shortId} (${name})`,
        provider: name,
        vision: !!m.vision,
      });
    }
  }
  const glm = providerHasGlmSearch(providers);
  return {
    models,
    default: models[0]?.id ?? null,
    capabilities: {
      webSearch: hasOpenRouter || glm || !!anysearchKey,
      searchEngine: hasOpenRouter ? 'openrouter-online'
        : glm ? 'glm-tools'
        : anysearchKey ? 'anysearch' : 'glm-tools',
      anysearch: !!anysearchKey,
      scholarSearch: true,
      vision: models.some((m) => m.vision),
    },
  };
}
