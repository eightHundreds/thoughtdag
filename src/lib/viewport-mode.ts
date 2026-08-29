import { GLYPH_ENTER, MAP_LANDING_ZOOM, workUnfoldAt } from './map-tier.ts';

// Copied so node:test can load this file without evaluating constants.ts
// (Vite `import.meta.env`). Keep in sync with NODE_CSS_WIDTH / PANEL_INSET.
const NODE_CSS_WIDTH = 520;
const PANEL_INSET = 12;

/** Chrome diet breakpoint. Matches `max-width: 959px`. Independent of the panel. */
export const NARROW_CHROME_MAX = 959;

/** Same 36px chrome as App.tsx `visibleRight`: PANEL_INSET + 24. */
export const PANEL_CHROME_PX = PANEL_INSET + 24;

/** Movement below this (screen px) counts as a tap, not a pan. */
export const SHEET_TAP_SLOP_PX = 12;

export function remainingVisible(innerWidth: number, panelWidth: number): number {
  return innerWidth - panelWidth - PANEL_CHROME_PX;
}

/** Whether remaining canvas is narrower than one work card. */
export function sheetAt(innerWidth: number, panelWidth: number): boolean {
  return remainingVisible(innerWidth, panelWidth) < NODE_CSS_WIDTH;
}

export function narrowChromeAt(innerWidth: number): boolean {
  return innerWidth <= NARROW_CHROME_MAX;
}

export function wheelPanPreferred(input: {
  hoverFine: boolean;
  pointerCoarse: boolean;
  uaMac: boolean;
}): boolean {
  return input.hoverFine && input.uaMac && !input.pointerCoarse;
}

export type GesturePolicy = {
  panOnDrag: true | [1, 2];
  selectionOnDrag: boolean;
  nodesDraggable: boolean;
  nodesConnectable: boolean;
  panOnScroll: boolean;
  zoomOnScroll: boolean;
  zoomOnPinch: true;
  zoomOnDoubleClick: false;
  /** Pass React Flow's uncontrolled `fitView` prop. False when we own the camera. */
  initialFitView: boolean;
};

export function gesturePolicy(input: {
  sheet: boolean;
  coarse: boolean;
  isViewer: boolean;
  wheelPan: boolean;
}): GesturePolicy {
  const panePan = input.sheet || input.coarse || input.isViewer;
  if (panePan) {
    return {
      panOnDrag: true,
      selectionOnDrag: false,
      nodesDraggable: false,
      nodesConnectable: false,
      panOnScroll: false,
      zoomOnScroll: false,
      zoomOnPinch: true,
      zoomOnDoubleClick: false,
      initialFitView: !input.sheet,
    };
  }
  return {
    panOnDrag: [1, 2],
    selectionOnDrag: true,
    nodesDraggable: true,
    nodesConnectable: true,
    panOnScroll: input.wheelPan,
    zoomOnScroll: !input.wheelPan,
    zoomOnPinch: true,
    zoomOnDoubleClick: false,
    initialFitView: true,
  };
}

/** Compact (sheet / coarse): plaques and glyphs drag the node; a work card
 *  fills the phone, so a finger there pans the canvas. Desktop always drags
 *  nodes. Viewer never does. */
export function nodeDragEnabled(input: {
  isViewer: boolean;
  sheet: boolean;
  coarse: boolean;
  zoomTier: 'work' | 'map' | 'glyph';
}): boolean {
  if (input.isViewer) return false;
  if (!(input.sheet || input.coarse)) return true;
  return input.zoomTier !== 'work';
}

/** Inner `nopan` / overflow-scroll steal one-finger pan. Compact work
 *  cards must not: they fill the phone, so the finger has to move the
 *  canvas. Desktop and compact map still lock pan on the card. */
export function cardStealsPan(input: { nodeDrag: boolean; sheet: boolean; coarse: boolean }): boolean {
  return input.nodeDrag || !(input.sheet || input.coarse);
}

export function toolbarRightPx(sheet: boolean, panelOpen: boolean, panelWidth: number): number {
  if (sheet || !panelOpen) return 16;
  return panelWidth + PANEL_INSET + 12;
}

export function clampMapLandingZoom(zoom: number, innerWidth = 1440): {
  zoom: number;
  recenterThought: boolean;
} {
  if (zoom >= workUnfoldAt(innerWidth)) return { zoom: MAP_LANDING_ZOOM, recenterThought: false };
  if (zoom <= GLYPH_ENTER) return { zoom: MAP_LANDING_ZOOM, recenterThought: true };
  return { zoom, recenterThought: false };
}

/** Screen-center → flow coords. Camera tests stub `screenToFlow`. */
export function worldAtScreenCenter(
  screenToFlow: (p: { x: number; y: number }) => { x: number; y: number },
  screen: { width: number; height: number },
): { x: number; y: number } {
  return screenToFlow({ x: screen.width / 2, y: screen.height / 2 });
}
