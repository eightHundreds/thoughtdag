import type { ThoughtNode } from '../types';

// Keep in sync with COLLAPSED_NODE_HEIGHT in constants.ts — this file stays
// a leaf so node:test can import it without evaluating Vite env.
const COLLAPSED_NODE_HEIGHT = 80;

// Estimated rendered height of a node — fallback when React Flow hasn't
// measured the DOM yet (fresh nodes) and for collapse shifting. Every
// variable region of the card is height-capped in CSS (question scrolls at
// 180px, the answer at 400px), so the estimate caps each part the same way
// — an uncapped formula here would keep spreading nodes for content the
// card no longer grows for.
export function estimateNodeHeight(node: ThoughtNode): number {
  if (node.data.isCollapsed) return COLLAPSED_NODE_HEIGHT;
  // Calibrated against measured DOM heights (2026-08): CJK markdown renders
  // ~1px per char at card width before the 400px CSS cap, chrome (header +
  // takeaway line + follow-up input + paddings) runs ~215px, and each
  // highlight row adds its own line. Under-estimating here is what made
  // map-mode relayout overlap once zoomed back in.
  const questionH = Math.min(180, 40 + (node.data.question || '').length / 1.2);
  const responseH = Math.min(400, (node.data.response || '').length / 1.05);
  const highlightsH = (node.data.highlights?.length ?? 0) * 26;
  const estimated = 215 + questionH + responseH + highlightsH;
  return Math.max(260, Math.min(900, estimated));
}

// World-space occupancy: the work-tier box. LOD (map plaques, glyph seals)
// paints inside this box and must never shrink it — otherwise two cards
// that were N px apart at work zoom stack when the box collapses.
export function occupancyHeight(node: Pick<ThoughtNode, 'data' | 'measured' | 'height'>): number {
  const stored = Math.max(node.measured?.height ?? 0, node.height ?? 0);
  const kind = node.data?.stepKind;
  if (kind === 'note' || kind === 'file' || kind === 'link' || kind === 'frame') {
    return stored || 120;
  }
  if (node.data?.isCollapsed) {
    return stored > 0 && stored < COLLAPSED_NODE_HEIGHT + 40 ? stored : COLLAPSED_NODE_HEIGHT;
  }
  // Prefer the stamped work-tier box. A leftover plaque/glyph measurement
  // (~128–176px) is not occupancy — fall back to the work-card estimate.
  if (stored >= 180) return stored;
  return estimateNodeHeight(node as ThoughtNode);
}

// Height used for layout: occupancy, never the current LOD thumbnail.
export function nodeHeight(node: ThoughtNode): number {
  return occupancyHeight(node);
}

const LOD_SIZED_KINDS = new Set(['frame', 'note', 'file', 'link']);

function isUserSized(kind: string | undefined): boolean {
  return !!kind && LOD_SIZED_KINDS.has(kind);
}

// React Flow sizes the wrapper from node.height. While map/glyph paint
// less content we KEEP that height so occupancy does not collapse. Back
// at work the card must hug its content again — otherwise handles sit
// at the bottom of an empty wrapper and the edge detaches from the card.
export function unlockWorkWrapper(node: ThoughtNode): ThoughtNode {
  if (isUserSized(node.data.stepKind) || node.height == null) return node;
  return { ...node, height: undefined };
}

// Leaving work: the wrapper must be at least the reserved work-tier box
// so map/glyph have a frame to paint inside. Use occupancy (measured box,
// not the char-count estimate) — the estimate over-sizes short cards and
// those extra pixels become a hole the wire cannot cross after zoom-in.
export function lockWorkWrapper(node: ThoughtNode): ThoughtNode {
  if (isUserSized(node.data.stepKind)) return node;
  const floor = occupancyHeight(node);
  if ((node.height ?? 0) >= floor) return node;
  return { ...node, height: floor };
}
