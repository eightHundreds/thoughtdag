/** Stateless zoom-tier thresholds. Occupancy / hysteresis live in
 *  `use-map-mode.ts`; camera code must import THESE numbers, never
 *  `getZoomTier()`. */
export const WORK_FOLD = 0.55;
export const WORK_UNFOLD = 0.9;
export const GLYPH_ENTER = 0.32;
export const GLYPH_LEAVE = 0.4;
export const MAP_LANDING_ZOOM = WORK_FOLD;

/** Keep in sync with NODE_CSS_WIDTH. Duplicated so node:test can load
 *  this file without evaluating constants.ts (Vite `import.meta.env`). */
const CARD_CSS_WIDTH = 520;

const MIN_WORK_HYSTERESIS = 0.08;
const UNFOLD_FLOOR = 0.48;

/** Unfold when the 520px card would cover this fraction of the viewport.
 *  1.0 = card width == viewport — still overflows chrome and feels late. */
export const WORK_FIT_FRACTION = 0.6;

/** Zoom at which map plaques unfold to work-tier content. Desktop keeps
 *  0.9. On a phone, unfold when the card is ~60% of the viewport so
 *  landing zoom (0.55) already shows full cards, not plaques. */
export function workUnfoldAt(innerWidth: number): number {
  const fits = (innerWidth * WORK_FIT_FRACTION) / CARD_CSS_WIDTH;
  return Math.min(WORK_UNFOLD, Math.max(fits, UNFOLD_FLOOR));
}

/** Zoom at which work cards fold back to plaques. Tracks unfold so a
 *  390px window can land in work without immediately folding. */
export function workFoldAt(innerWidth: number): number {
  const unfold = workUnfoldAt(innerWidth);
  const fold = unfold - MIN_WORK_HYSTERESIS;
  const floor = GLYPH_LEAVE + 0.02;
  return Math.min(WORK_FOLD, Math.max(fold, floor));
}
