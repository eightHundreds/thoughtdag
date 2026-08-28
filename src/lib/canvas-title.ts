import type { ThoughtNode, ThoughtData } from '../types';

// One-shot title for a canvas: the model reads every node's question and
// takeaway (display summaries only) and returns a notebook-style name.
// Never writes the graph — callers persist via renameProject.

const MAX_ROWS = 80;
const Q_SLICE = 160;

export interface TitleSourceRow {
  question: string;
  summary?: string;
}

function nodeLabel(d: ThoughtData): string {
  if (d.stepKind === 'file') return d.attachments?.[0]?.name ?? '';
  if (d.stepKind === 'link') return (d.linkTitle || d.linkUrl || '').replace(/^⚠\s*/, '');
  return (d.question || '').replace(/\s+/g, ' ').trim();
}

/** Nodes the namer reads: no frames, no archives, question and/or summary. */
export function collectTitleSource(nodes: ThoughtNode[]): TitleSourceRow[] {
  const rows: TitleSourceRow[] = [];
  for (const n of nodes) {
    const d = n.data as ThoughtData;
    if (d.stepKind === 'frame' || d.archived) continue;
    const question = nodeLabel(d).slice(0, Q_SLICE);
    const summary = d.summaries?.[d.responseIndex] ?? d.summary ?? undefined;
    if (!question && !summary) continue;
    rows.push({ question, ...(summary ? { summary } : {}) });
    if (rows.length >= MAX_ROWS) break;
  }
  return rows;
}

export function formatTitleSource(rows: TitleSourceRow[]): string {
  return rows.map((r, i) => {
    const q = r.question || '(untitled)';
    return r.summary ? `${i + 1}. ${q}\n   摘要: ${r.summary}` : `${i + 1}. ${q}`;
  }).join('\n');
}

export function sanitizeCanvasTitle(raw: string): string {
  let s = raw.trim().split('\n')[0]?.trim() ?? '';
  s = s.replace(/^["「『“”''#*\s]+/, '').replace(/["」』“”''#*]+$/, '').trim();
  s = s.replace(/[—–]/g, '，').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  const chars = [...s];
  const cjk = chars.filter((c) => c.charCodeAt(0) > 0x2e80).length;
  const max = cjk * 2 >= chars.length ? 20 : 48;
  return chars.length > max ? chars.slice(0, max).join('').trim() : s;
}

export async function generateCanvasTitle(nodes: ThoughtNode[], lang: 'zh' | 'en'): Promise<string> {
  const rows = collectTitleSource(nodes);
  if (rows.length === 0) {
    const err = new Error('empty');
    err.name = 'CanvasTitleEmpty';
    throw err;
  }
  const body = formatTitleSource(rows);
  const { llmCall } = await import('./api');
  const raw = await llmCall([
    {
      role: 'user',
      content:
        `These are the turns of a thinking canvas. Each numbered item is a node: its question (or material name), and its takeaway (摘要) when one exists.\n\n${body}\n\nWrite ONE short title for this canvas, as a researcher would name a notebook: the subject, and where the thinking landed if that is already clear. Hard limit: 20 characters for CJK languages, 48 characters otherwise. Write in ${lang === 'zh' ? 'Chinese' : 'English'} (the reader's interface language), even if the nodes mix languages. Never use dash characters (—, –, -). No quotes, no numbering, no preamble. Output only the title.`,
    },
  ]);
  const title = sanitizeCanvasTitle(raw);
  if (!title) {
    const err = new Error('empty-output');
    err.name = 'CanvasTitleEmpty';
    throw err;
  }
  return title;
}
