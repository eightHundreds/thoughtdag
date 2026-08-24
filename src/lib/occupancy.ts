import type { ThoughtNode, ThoughtEdge } from '../types';

// Keep in sync with COLLAPSED_NODE_HEIGHT in constants.ts — this file stays
// a leaf so node:test can import it without evaluating Vite env.
const COLLAPSED_NODE_HEIGHT = 140;

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
    // A folded card measures ~120–180px. A leftover expanded stamp is 220+.
    // Trust a collapsed-sized measurement; otherwise use the folded estimate
    // — treating 140 as "too tall to be folded" packed chains on 一键排版.
    if (stored >= 70 && stored <= 200) return stored;
    return COLLAPSED_NODE_HEIGHT;
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

// ── Local insert ──────────────────────────────────────────────────────
// Full autoLayout rewrites every thought-node's x/y. Asking a follow-up
// must not do that: other trees keep the positions the user dragged them
// to. This places ONE new card by the arrow grammar (same column under
// the parent for a continuation, next column for a sibling / explore)
// and only shifts descendants of that parent when they would overlap.

const CONTENT_KINDS = new Set(['note', 'file', 'link', 'frame']);
const COL_PITCH = 540 + 48;
const V_GAP = 72;
const V_PAD = 24;
const SAME_COL = 200;

function isContent(n: ThoughtNode): boolean {
  return CONTENT_KINDS.has(n.data.stepKind ?? '');
}

function descendantIds(startId: string, edges: ThoughtEdge[], skip?: string): string[] {
  const out: string[] = [];
  const queue = [startId];
  const seen = new Set<string>(skip ? [skip] : []);
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const e of edges) {
      if (e.source !== current || e.data?.isCrossLink) continue;
      if (seen.has(e.target)) continue;
      seen.add(e.target);
      out.push(e.target);
      queue.push(e.target);
    }
  }
  return out;
}

export interface InsertLocalOpts {
  parentId?: string | null;
  /** Extra parents for multi-select explore / merge (first is the column). */
  parentIds?: string[];
  branch?: boolean;
  collapseParent?: boolean;
}

export function insertNodeLocally(
  allNodes: ThoughtNode[],
  allEdges: ThoughtEdge[],
  newId: string,
  opts: InsertLocalOpts = {},
): ThoughtNode[] {
  const fresh = allNodes.find((n) => n.id === newId);
  if (!fresh) return allNodes;

  let nodes = allNodes;
  const parentIds = [
    ...new Set(
      [...(opts.parentIds ?? []), opts.parentId ?? '']
        .filter((id): id is string => !!id && id !== newId),
    ),
  ];
  const parent = parentIds[0] ? nodes.find((n) => n.id === parentIds[0]) : undefined;

  if (opts.collapseParent && parent && !parent.data.isCollapsed && !isContent(parent)) {
    const oldH = occupancyHeight(parent);
    const collapsed: ThoughtNode = {
      ...parent,
      height: COLLAPSED_NODE_HEIGHT,
      measured: { width: parent.measured?.width ?? 520, height: COLLAPSED_NODE_HEIGHT },
      data: { ...parent.data, isCollapsed: true },
    };
    const delta = occupancyHeight(collapsed) - oldH;
    const desc = new Set(descendantIds(parent.id, allEdges, newId));
    nodes = nodes.map((n) => {
      if (n.id === parent.id) return collapsed;
      if (delta !== 0 && desc.has(n.id)) {
        return { ...n, position: { ...n.position, y: n.position.y + delta } };
      }
      return n;
    });
  }

  const parentNow = parentIds[0] ? nodes.find((n) => n.id === parentIds[0]) : undefined;
  const others = nodes.filter((n) => n.id !== newId && !isContent(n));

  let x: number;
  let y: number;

  if (!parentNow) {
    if (others.length === 0) {
      x = 0;
      y = 0;
    } else {
      const right = others.reduce((a, b) => (a.position.x >= b.position.x ? a : b));
      x = right.position.x + COL_PITCH;
      y = Math.min(...others.map((n) => n.position.y));
    }
  } else if (parentIds.length > 1) {
    const parents = parentIds
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is ThoughtNode => !!n);
    x = parentNow.position.x;
    y = Math.max(...parents.map((p) => p.position.y + occupancyHeight(p))) + V_GAP;
  } else {
    const pH = occupancyHeight(parentNow);
    const outgoing = allEdges.filter(
      (e) => e.source === parentNow.id && e.target !== newId && !e.data?.isCrossLink && !e.data?.isWatch,
    );
    const exploreIds = new Set(
      outgoing.filter((e) => e.data?.isBranchFromSelection).map((e) => e.target),
    );
    const nonExplore = outgoing.map((e) => e.target).filter((id) => !exploreIds.has(id));
    const isBranch = !!opts.branch;

    if (isBranch) {
      const side = nodes.filter((n) => outgoing.some((e) => e.target === n.id) || n.id === parentNow.id);
      const rightmost = side.reduce((a, b) => (a.position.x >= b.position.x ? a : b));
      x = rightmost.position.x + COL_PITCH;
      y = parentNow.position.y + pH * 0.25;
    } else if (nonExplore.length === 0) {
      x = parentNow.position.x;
      y = parentNow.position.y + pH + V_GAP;
    } else {
      const sibs = nodes.filter((n) => nonExplore.includes(n.id));
      const rightmost = sibs.reduce((a, b) => (a.position.x >= b.position.x ? a : b));
      x = rightmost.position.x + COL_PITCH;
      y = sibs[0]?.position.y ?? parentNow.position.y + pH + V_GAP;
    }
  }

  nodes = nodes.map((n) => (n.id === newId ? { ...n, position: { x, y } } : n));

  // Same-chain only: push descendants of the parent (or the new root's
  // future neighbors are NOT moved) that now overlap the new card.
  const chainIds = new Set(
    parentNow ? descendantIds(parentNow.id, allEdges, newId) : [],
  );
  const placed = nodes.find((n) => n.id === newId)!;
  const placedBottom = placed.position.y + occupancyHeight(placed) + V_PAD;
  let push = 0;
  for (const n of nodes) {
    if (!chainIds.has(n.id)) continue;
    if (Math.abs(n.position.x - placed.position.x) >= SAME_COL) continue;
    if (n.position.y >= placed.position.y && n.position.y < placedBottom) {
      push = Math.max(push, placedBottom - n.position.y);
    }
  }
  if (push > 0) {
    nodes = nodes.map((n) =>
      chainIds.has(n.id) && Math.abs(n.position.x - placed.position.x) < SAME_COL && n.position.y >= placed.position.y
        ? { ...n, position: { ...n.position, y: n.position.y + push } }
        : n,
    );
  }

  return nodes;
}
