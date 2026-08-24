import { API_BASE } from './constants';
import type { Reference } from '../types';
import type { RuntimeProvider } from './runtime-providers';

export type SearchHit = Reference & { authors?: string; content?: string };

export type SearchToolName = 'web_search' | 'arxiv_search' | 'semantic_scholar';

export const SEARCH_TOOL_NAMES: SearchToolName[] = ['web_search', 'arxiv_search', 'semantic_scholar'];

/** OpenAI-compatible tool defs — keep descriptions in sync with functions/api. */
export const SEARCH_TOOL_DEFS: Record<SearchToolName, {
  type: 'function';
  function: { name: SearchToolName; description: string; parameters: object };
}> = {
  web_search: {
    type: 'function',
    function: {
      name: 'web_search',
      description:
        'ONLY for current events, time-sensitive facts, or specific verifiable claims you cannot answer confidently from your own knowledge. ' +
        'NEVER use for conceptual, definitional, reasoning or creative questions — answer those directly. ' +
        'Results are numbered [1], [2], ... — when you use information from a result, cite it inline as [n]. At most 3 searches per answer.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query, in the language most likely to find good results' } },
        required: ['query'],
      },
    },
  },
  arxiv_search: {
    type: 'function',
    function: {
      name: 'arxiv_search',
      description:
        'Search arXiv for academic papers and preprints (physics, math, CS, ML, stats…). ' +
        'ONLY when the user asks about papers or literature, or a claim genuinely needs a scholarly citation — not for questions you can answer directly. Returns title, authors, abstract, and link, numbered for [n] citations.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search terms — paper title, topic, method, or author. English works best on arXiv.' } },
        required: ['query'],
      },
    },
  },
  semantic_scholar: {
    type: 'function',
    function: {
      name: 'semantic_scholar',
      description:
        'Search Semantic Scholar across all scholarly fields — includes citation counts, useful for judging impact and finding published (peer-reviewed) work beyond preprints. Numbered for [n] citations.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Search terms — topic, title, or author, in English' } },
        required: ['query'],
      },
    },
  },
};

export const TOOL_LOOP_DIRECTIVE = [
  'Tools are AVAILABLE, not mandatory: first decide whether your own knowledge answers the question. Conceptual, definitional, reasoning and creative questions must be answered DIRECTLY, with no tool calls. Search only when the answer depends on current events, specific verifiable facts you are unsure of, or literature citations — or when the user explicitly asks you to look something up.',
  'After using any search tool, you MUST follow up with a complete answer that SYNTHESIZES the results in your own words — analyze and conclude, never just list the results.',
  "Cite sources inline as [n], using EXACTLY the bracket numbers shown in this turn's search results (they always start at [1]). Ignore any citation numbers appearing in earlier conversation messages — they refer to different sources.",
  'If the search results are not actually relevant to the question, say so explicitly and answer from your own knowledge instead of forcing citations.',
  'Never end your turn immediately after a search.',
].join(' ');

/** Run one search tool through the Worker sidecar (CORS / SSRF). */
export async function sidecarSearch(
  tool: SearchToolName,
  query: string,
  opts: {
    anysearchKey?: string;
    searchEngine?: string;
    providers?: Pick<RuntimeProvider, 'baseURL' | 'apiKey'>[];
    signal?: AbortSignal;
  },
): Promise<{ text: string; sources: SearchHit[] }> {
  const res = await fetch(`${API_BASE}/api/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tool,
      query,
      anysearchKey: opts.anysearchKey || undefined,
      searchEngine: opts.searchEngine && opts.searchEngine !== 'server' ? opts.searchEngine : undefined,
      providers: (opts.providers ?? []).map((p) => ({ baseURL: p.baseURL, apiKey: p.apiKey })),
    }),
    signal: opts.signal,
  });
  const data = await res.json().catch(() => ({})) as { text?: string; sources?: SearchHit[]; error?: string };
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return { text: data.text || '', sources: Array.isArray(data.sources) ? data.sources : [] };
}
