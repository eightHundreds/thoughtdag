import { useStore as useRfStore } from '@xyflow/react';
import { GLYPH_ENTER, GLYPH_LEAVE, workFoldAt, workUnfoldAt } from './map-tier';
import { useViewportMode } from './use-viewport-mode';

export {
  GLYPH_ENTER,
  GLYPH_LEAVE,
  MAP_LANDING_ZOOM,
  WORK_FOLD,
  WORK_UNFOLD,
  workFoldAt,
  workUnfoldAt,
} from './map-tier';

/**
 * Semantic zoom, three tiers with hysteresis at both boundaries:
 *
 *   work  (stay until zoom <= fold) — full cards: read the content
 *   map   (~0.4 – unfold)           — takeaway plaques
 *   glyph (zoom < ~0.35)            — one seal per node
 *
 * Unfold is 0.9 on a wide window. On a phone it drops so a 520px card
 * covers ~60% of the viewport — landing zoom already shows work cards.
 *
 * Tiers only change what is painted INSIDE a node. World occupancy is
 * frozen at the work-tier box (see occupancyHeight / onNodesChange) so
 * zoom never closes gaps or stacks cards.
 *
 * Module-level state (not a per-component ref) so every subscriber and
 * onNodesChange see the same side of the hysteresis.
 */
export type ZoomTier = 'work' | 'map' | 'glyph';

let canvasTier: ZoomTier = 'work';

function stepTier(z: number, cur: ZoomTier, fold: number, unfold: number): ZoomTier {
  if (cur === 'work') {
    if (z <= fold) return z <= GLYPH_ENTER ? 'glyph' : 'map';
    return 'work';
  }
  if (cur === 'map') {
    if (z >= unfold) return 'work';
    if (z <= GLYPH_ENTER) return 'glyph';
    return 'map';
  }
  if (z >= unfold) return 'work';
  if (z >= GLYPH_LEAVE) return 'map';
  return 'glyph';
}

function liveWidth(): number {
  return typeof window !== 'undefined' ? window.innerWidth : 1440;
}

/** Latest canvas tier — safe to call outside React (e.g. onNodesChange).
 *  Pass `z` to step hysteresis from a zoom we already have, so writeback
 *  does not wait on a React render. */
export function getZoomTier(z?: number): ZoomTier {
  if (typeof z === 'number') {
    const w = liveWidth();
    canvasTier = stepTier(z, canvasTier, workFoldAt(w), workUnfoldAt(w));
  }
  return canvasTier;
}

export function useZoomTier(): ZoomTier {
  const innerWidth = useViewportMode().innerWidth;
  const fold = workFoldAt(innerWidth);
  const unfold = workUnfoldAt(innerWidth);
  return useRfStore((s) => {
    canvasTier = stepTier(s.transform[2], canvasTier, fold, unfold);
    return canvasTier;
  });
}

/** Legacy boolean view: true whenever cards are folded (map OR glyph). */
export function useMapMode(): boolean {
  return useZoomTier() !== 'work';
}
