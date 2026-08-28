import type { ContextMessage, ImageAttachment, StreamCallbacks } from './api';
import type { Reference } from '../types';
import { isHostedProxy } from './constants';
import { storedProviders, type RuntimeProvider } from './runtime-providers';
import { isLoopbackURL, isOpenRouterURL, pickDirectProvider, providerHasGlmSearch } from './provider-catalog';
import {
  SEARCH_TOOL_DEFS,
  SEARCH_TOOL_NAMES,
  TOOL_LOOP_DIRECTIVE,
  sidecarSearch,
  type SearchHit,
  type SearchToolName,
} from './sidecar-search';
import { t } from '../i18n';

// Direct browser→gateway streaming. Generation talks to the gateway from
// the page (hosted and local). The sidecar (Worker / Node) stays for the
// few calls browsers cannot make: search APIs, URL snapshots, PDF extract,
// /models CORS fallback. Models that exist only in a local .env still
// ride the Node proxy.

export interface DirectToolOpts {
  web?: boolean;
  scholar?: boolean;
  anysearchKey?: string;
  searchEngine?: string;
  providers?: RuntimeProvider[];
}

/** The provider to talk to directly for this model, or null → use the proxy
    (.env-only models, or a local loopback runtime with no CORS). */
export { pickDirectProvider };

export function directProvider(modelId?: string): RuntimeProvider | null {
  const p = pickDirectProvider(modelId, storedProviders());
  if (!p) return null;
  // Ollama / ChatGPT-plan bridge have no CORS; local Node can still reach them.
  if (!isHostedProxy() && isLoopbackURL(p.baseURL)) return null;
  return p;
}

// Keep in sync with baseDirective() in server.mjs / functions/api/[[path]].js
function baseDirective(): string {
  return [
    `Current date: ${new Date().toISOString().slice(0, 10)}.`,
    'Respond in the language of the latest user message unless asked otherwise.',
    'Bracketed markers such as [Note], [Reference: …], [Link snapshot: …], [Important]…[/Important] and [Stale: …] are provenance labels attached to your context by the canvas. Use them to judge where information came from and how much to trust it; never repeat the markers themselves in the answer.',
  ].join(' ');
}

type OpenAiContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

interface ToolCallWire {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string | OpenAiContentPart[] }
  | { role: 'assistant'; content: string; tool_calls?: ToolCallWire[] }
  | { role: 'tool'; tool_call_id: string; content: string };

function toOpenAiMessages(messages: ContextMessage[], images?: ImageAttachment[]): OpenAiMessage[] {
  const systemParts: string[] = [baseDirective()];
  const out: OpenAiMessage[] = [];
  messages.forEach((m, i) => {
    if (m.role === 'system') { systemParts.push(m.content); return; }
    const isLastUser = i === messages.length - 1 && m.role === 'user';
    if (isLastUser && images && images.length > 0) {
      out.push({
        role: 'user',
        content: [
          { type: 'text', text: m.content },
          ...images.map((img) => ({
            type: 'image_url' as const,
            image_url: { url: `data:${img.mimeType || 'image/png'};base64,${img.data}` },
          })),
        ],
      });
    } else {
      out.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }
  });
  return [{ role: 'system', content: systemParts.join('\n\n') }, ...out];
}

function friendlyNetworkError(err: unknown): Error {
  if (err instanceof DOMException && err.name === 'AbortError') return err as unknown as Error;
  const message = err instanceof Error ? err.message : 'Unknown error';
  if (/Failed to fetch|NetworkError|Load failed|fetch|network/i.test(message)) {
    return new Error(t('error.directCors'));
  }
  return new Error(message);
}

function gatewayHeaders(provider: RuntimeProvider): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (provider.apiKey) headers.Authorization = `Bearer ${provider.apiKey}`;
  // OpenRouter documents X-Title; sending it elsewhere fails CORS preflight
  // on gateways that only allow authorization + content-type.
  if (isOpenRouterURL(provider.baseURL)) headers['X-Title'] = 'ThoughtDAG';
  return headers;
}

interface UrlCitation { url?: string; title?: string }
interface SseChoice {
  delta?: {
    content?: string | { type?: string; text?: string }[];
    reasoning?: string;
    reasoning_content?: string;
    annotations?: { type?: string; url_citation?: UrlCitation }[];
    tool_calls?: { index?: number; id?: string; type?: string; function?: { name?: string; arguments?: string } }[];
  };
  finish_reason?: string | null;
}
interface SseChunk { choices?: SseChoice[]; error?: { message?: string } | string }

interface ToolCallAcc { id: string; name: string; args: string }

function deltaText(delta: SseChoice['delta']): string {
  const c = delta?.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((p) => (typeof p === 'string' ? p : p?.text ?? '')).join('');
  return '';
}

function applyToolDelta(acc: ToolCallAcc[], parts: NonNullable<SseChoice['delta']>['tool_calls']) {
  if (!parts) return;
  for (const part of parts) {
    const i = part.index ?? Math.max(0, acc.length - 1);
    while (acc.length <= i) acc.push({ id: '', name: '', args: '' });
    const slot = acc[i];
    if (part.id) slot.id = part.id;
    if (part.function?.name) slot.name += part.function.name;
    if (part.function?.arguments) slot.args += part.function.arguments;
  }
}

function filterToolCallLeak(chunk: string, holdback: { v: string }): string {
  let buf = holdback.v + chunk;
  holdback.v = '';
  buf = buf.replace(/<tool_call>[\s\S]*?<\/tool_call>\n?/g, '');
  const open = buf.search(/<tool_call/);
  if (open !== -1) {
    holdback.v = buf.slice(open);
    return buf.slice(0, open);
  }
  for (let k = Math.min(buf.length, 10); k > 0; k--) {
    if ('<tool_call'.startsWith(buf.slice(-k))) {
      holdback.v = buf.slice(-k);
      return buf.slice(0, -k);
    }
  }
  return buf;
}

interface StreamPassResult {
  text: string;
  finishReason: string;
  toolCalls: ToolCallAcc[];
  httpStatus?: number;
}

async function streamOnePass(
  provider: RuntimeProvider,
  model: string,
  messages: OpenAiMessage[],
  onText: (chunk: string) => void,
  onReasoning: (chunk: string) => void,
  citations: Map<string, Reference>,
  extra: Record<string, unknown> | undefined,
  signal?: AbortSignal,
): Promise<StreamPassResult> {
  const res = await fetch(`${provider.baseURL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: gatewayHeaders(provider),
    body: JSON.stringify({
      model,
      stream: true,
      messages,
      stream_options: { include_usage: true },
      ...(isOpenRouterURL(provider.baseURL) ? { reasoning: { enabled: true }, usage: { include: true } } : {}),
      ...extra,
    }),
    signal,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null) as { error?: { message?: string } | string } | null;
    const msg = typeof err?.error === 'string' ? err.error : err?.error?.message;
    const wrapped = new Error(msg || `HTTP ${res.status}`) as Error & { httpStatus: number };
    wrapped.httpStatus = res.status;
    throw wrapped;
  }

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let finishReason = 'unknown';
  const toolCalls: ToolCallAcc[] = [];
  const holdback = { v: '' };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;
      let chunk: SseChunk;
      try { chunk = JSON.parse(data) as SseChunk; } catch { continue; }
      if (chunk.error) {
        const msg = typeof chunk.error === 'string' ? chunk.error : chunk.error.message;
        throw new Error(msg || 'Upstream stream error');
      }
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      const raw = deltaText(delta);
      if (raw) {
        const filtered = filterToolCallLeak(raw, holdback);
        if (filtered) { text += filtered; onText(filtered); }
      }
      const reasoning = delta?.reasoning ?? delta?.reasoning_content;
      if (reasoning) onReasoning(reasoning);
      applyToolDelta(toolCalls, delta?.tool_calls);
      for (const a of delta?.annotations ?? []) {
        const c = a.url_citation;
        if (c?.url && !citations.has(c.url)) {
          citations.set(c.url, { title: c.title || c.url, url: c.url, media: 'Web' });
        }
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }
  if (holdback.v && !holdback.v.startsWith('<tool_call')) {
    text += holdback.v;
    onText(holdback.v);
  }
  return { text, finishReason, toolCalls: toolCalls.filter((c) => c.name) };
}

function toolQuery(args: string): string {
  try {
    const parsed = JSON.parse(args || '{}') as { query?: unknown };
    if (typeof parsed.query === 'string' && parsed.query.trim()) return parsed.query.trim();
  } catch { /* raw string fallback */ }
  return args.trim();
}

function isSearchTool(name: string): name is SearchToolName {
  return (SEARCH_TOOL_NAMES as string[]).includes(name);
}

/**
 * Streaming call straight to the gateway. OpenRouter web search uses the
 * `:online` suffix; other search tools hop through the Worker sidecar.
 */
export async function directLlmStream(
  provider: RuntimeProvider,
  modelId: string,
  contextMessages: ContextMessage[],
  onChunk: (chunk: string, fullSoFar: string) => void,
  signal?: AbortSignal,
  images?: ImageAttachment[],
  callbacks?: StreamCallbacks,
  toolPrefs?: DirectToolOpts | boolean,
): Promise<string> {
  // Older callers passed `webSearch?: boolean` as the last arg.
  const opts: DirectToolOpts = typeof toolPrefs === 'boolean' ? { web: toolPrefs } : (toolPrefs ?? {});
  const messages = toOpenAiMessages(contextMessages, images);
  const useOnline = isOpenRouterURL(provider.baseURL) && opts.web !== false;
  const providers = opts.providers ?? storedProviders();
  const canWebSidecar = !useOnline && opts.web !== false
    && (!!opts.anysearchKey || providerHasGlmSearch(providers));
  const canScholar = opts.scholar !== false;

  const tools: typeof SEARCH_TOOL_DEFS[SearchToolName][] = [];
  if (canWebSidecar) tools.push(SEARCH_TOOL_DEFS.web_search);
  if (canScholar) {
    tools.push(SEARCH_TOOL_DEFS.arxiv_search);
    tools.push(SEARCH_TOOL_DEFS.semantic_scholar);
  }
  if (tools.length > 0) {
    const sys = messages[0];
    if (sys?.role === 'system' && typeof sys.content === 'string') {
      sys.content = `${sys.content}\n\n${TOOL_LOOP_DIRECTIVE}`;
    }
  }

  const citations = new Map<string, Reference>();
  const sources: SearchHit[] = [];
  let full = '';
  let reasoningFull = '';
  let charsAtLastSearch = 0;
  const onText = (chunk: string) => { full += chunk; onChunk(chunk, full); };
  const onReasoning = (chunk: string) => {
    reasoningFull += chunk;
    callbacks?.onReasoning?.(chunk, reasoningFull);
  };

  const extraFor = (step: number, allowTools: boolean): Record<string, unknown> | undefined => {
    if (!allowTools || tools.length === 0 || step >= 3) return undefined;
    return { tools, tool_choice: 'auto' };
  };

  try {
    let pass: StreamPassResult | undefined;
    for (let step = 0; step < 5; step++) {
      const model = useOnline && step === 0 ? `${modelId}:online` : modelId;
      if (step === 0 && useOnline) callbacks?.onGatewaySearch?.();
      try {
        pass = await streamOnePass(
          provider, model, messages, onText, onReasoning, citations, extraFor(step, true), signal);
      } catch (err) {
        const http = (err as Error & { httpStatus?: number }).httpStatus;
        const msg = err instanceof Error ? err.message : '';
        if (step === 0 && tools.length > 0 && http === 400 && /tool/i.test(msg)) {
          pass = await streamOnePass(
            provider, model, messages, onText, onReasoning, citations, undefined, signal);
        } else {
          throw err;
        }
      }

      const calls = pass.toolCalls.filter((c) => c.name);
      if (calls.length === 0) break;
      if (step >= 3) break;

      const wires: ToolCallWire[] = calls.map((c, i) => ({
        id: c.id || `call_${step}_${i}`,
        type: 'function',
        function: { name: c.name, arguments: c.args || '{}' },
      }));
      messages.push({ role: 'assistant', content: pass.text || '', tool_calls: wires });

      for (const call of wires) {
        const name = call.function.name;
        const query = toolQuery(call.function.arguments);
        charsAtLastSearch = full.length;
        callbacks?.onToolCall?.(name, query);
        if (!isSearchTool(name)) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: `Unknown tool ${name}.` });
          continue;
        }
        try {
          const result = await sidecarSearch(name, query, {
            anysearchKey: opts.anysearchKey,
            searchEngine: opts.searchEngine,
            providers,
            signal,
          });
          for (const s of result.sources) {
            if (s.url && !citations.has(s.url)) citations.set(s.url, s);
            sources.push(s);
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: result.text });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          messages.push({ role: 'tool', tool_call_id: call.id, content: `Search failed (${msg}) — answer from your knowledge.` });
        }
      }
    }

    // :online sometimes closes with zero text — retry once with the plain model.
    if (useOnline && full.length === 0) {
      pass = await streamOnePass(
        provider, modelId, toOpenAiMessages(contextMessages, images), onText, onReasoning, citations, undefined, signal);
    }

    // Searched but wrote almost nothing after the last search: one tool-free synthesis.
    if (sources.length > 0 && full.length - charsAtLastSearch < 200) {
      const numbered = sources
        .map((r, i) => `[${i + 1}] ${r.title}${r.authors ? ` — ${r.authors}` : ''}${r.date ? ` (${r.date})` : ''}\n${r.url ?? ''}\n${r.content ?? ''}`)
        .join('\n\n');
      const lastUser = [...contextMessages].reverse().find((m) => m.role === 'user');
      messages.push({
        role: 'user',
        content:
          `Search results:\n\n${numbered}\n\n` +
          `Based on these results and your own knowledge, write the final synthesized answer to my previous question` +
          `${lastUser ? ` ("${String(lastUser.content).slice(0, 200)}")` : ''}. ` +
          'Analyze rather than list; cite sources inline as [n] using the numbers above; if the results are not relevant, say so and answer from your own knowledge.',
      });
      pass = await streamOnePass(
        provider, modelId, messages, onText, onReasoning, citations, undefined, signal);
    }

    if (full.length === 0) {
      throw new Error(`Model produced no text (finish: ${pass?.finishReason ?? 'unknown'}, model: ${modelId}${useOnline ? ' via :online' : ''})`);
    }
    const merged: Reference[] = sources.length > 0 ? sources : [...citations.values()];
    if (merged.length > 0) callbacks?.onSources?.(merged);
    return full;
  } catch (err: unknown) {
    throw friendlyNetworkError(err);
  }
}

/** Extra body fields that ask OpenAI-compatible gateways not to think.
    Unknown keys are ignored; known ones turn off GLM/Qwen/Kimi/OR. */
export function noThinkingFields(): Record<string, unknown> {
  return {
    reasoning: { enabled: false },
    thinking: { type: 'disabled' },
    enable_thinking: false,
  };
}

/** Non-streaming call straight to the gateway (background summaries etc.). */
export async function directLlmCall(
  provider: RuntimeProvider,
  modelId: string,
  contextMessages: ContextMessage[],
  images?: ImageAttachment[],
  opts?: { thinking?: boolean },
): Promise<string> {
  try {
    const res = await fetch(`${provider.baseURL.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: gatewayHeaders(provider),
      body: JSON.stringify({
        model: modelId,
        messages: toOpenAiMessages(contextMessages, images),
        ...(opts?.thinking === false ? noThinkingFields() : {}),
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new Error(err?.error?.message || `HTTP ${res.status}`);
    }
    const data = await res.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  } catch (err: unknown) {
    throw friendlyNetworkError(err);
  }
}
