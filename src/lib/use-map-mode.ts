import { useStore as useRfStore } from '@xyflow/react';

/**
 * Semantic zoom, three tiers with hysteresis at both boundaries:
 *
 *   work  (stay until zoom <= 0.55) — full cards: read the content
 *   map   (~0.4 – 0.9)              — takeaway plaques
 *   glyph (zoom < ~0.35)            — one seal per node
 *
 * Tiers only change what is painted INSIDE a node. World occupancy is
 * frozen at the work-tier box (see occupancyHeight / onNodesChange) so
 * zoom never closes gaps or stacks cards.
 *
 * Module-level state (not a per-component ref) so every subscriber and
 * onNodesChange see the same side of the hysteresis.
 */
export type ZoomTier = 'work' | 'map' | 'glyph';

const WORK_FOLD = 0.55;
const GLYPH_ENTER = 0.32;
const WORK_UNFOLD = 0.9;
const GLYPH_LEAVE = 0.4;

let canvasTier: ZoomTier = 'work';

function stepTier(z: number, cur: ZoomTier): ZoomTier {
  if (cur === 'work') {
    if (z <= WORK_FOLD) return z <= GLYPH_ENTER ? 'glyph' : 'map';
    return 'work';
  }
  if (cur === 'map') {
    if (z >= WORK_UNFOLD) return 'work';
    if (z <= GLYPH_ENTER) return 'glyph';
    return 'map';
  }
  if (z >= WORK_UNFOLD) return 'work';
  if (z >= GLYPH_LEAVE) return 'map';
  return 'glyph';
}

/** Latest canvas tier — safe to call outside React (e.g. onNodesChange).
 *  Pass `z` to step hysteresis from a zoom we already have, so writeback
 *  does not wait on a React render. */
export function getZoomTier(z?: number): ZoomTier {
  if (typeof z === 'number') canvasTier = stepTier(z, canvasTier);
  return canvasTier;
}

export function useZoomTier(): ZoomTier {
  return useRfStore((s) => {
    canvasTier = stepTier(s.transform[2], canvasTier);
    return canvasTier;
  });
}

/** Legacy boolean view: true whenever cards are folded (map OR glyph). */
export function useMapMode(): boolean {
  return useZoomTier() !== 'work';
}
