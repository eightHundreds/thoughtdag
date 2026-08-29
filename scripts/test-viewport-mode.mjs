// Viewport-mode policy: remaining width, chrome breakpoint, camera clamp,
// gesture table. Must not import getZoomTier (hysteresis is not camera).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  remainingVisible,
  sheetAt,
  narrowChromeAt,
  wheelPanPreferred,
  gesturePolicy,
  nodeDragEnabled,
  cardStealsPan,
  clampMapLandingZoom,
  worldAtScreenCenter,
  toolbarRightPx,
  NARROW_CHROME_MAX,
  PANEL_CHROME_PX,
} from '../src/lib/viewport-mode.ts';
import { WORK_FOLD, WORK_UNFOLD, WORK_FIT_FRACTION, workFoldAt, workUnfoldAt } from '../src/lib/map-tier.ts';

const TABLE = [
  [320, 520, -236, true, true],
  [320, 380, -96, true, true],
  [390, 520, -166, true, true],
  [390, 380, -26, true, true],
  [768, 520, 212, true, true],
  [768, 380, 352, true, true],
  [834, 520, 278, true, true],
  [834, 380, 418, true, true],
  [959, 520, 403, true, true],
  [1024, 520, 468, true, false],
  [1024, 380, 608, false, false],
  [1024, 717, 271, true, false],
  [1366, 520, 810, false, false],
  [1366, 380, 950, false, false],
  [1440, 520, 884, false, false],
];

test('chrome inset is 36px', () => {
  assert.equal(PANEL_CHROME_PX, 36);
  assert.equal(NARROW_CHROME_MAX, 959);
});

test('remaining-width table (innerWidth × panelWidth)', () => {
  for (const [w, panel, remaining, sheet, narrow] of TABLE) {
    assert.equal(remainingVisible(w, panel), remaining, `remaining ${w}×${panel}`);
    assert.equal(sheetAt(w, panel), sheet, `sheet ${w}×${panel}`);
    assert.equal(narrowChromeAt(w), narrow, `narrowChrome ${w}`);
  }
});

test('1024 landscape: default 520 panel is sheet; shrunk 380 is overlay', () => {
  assert.equal(sheetAt(1024, 520), true);
  assert.equal(sheetAt(1024, 380), false);
});

test('clampMapLandingZoom: work → 0.55, map stays, glyph recenters', () => {
  assert.deepEqual(clampMapLandingZoom(1), { zoom: 0.55, recenterThought: false });
  assert.deepEqual(clampMapLandingZoom(0.9), { zoom: 0.55, recenterThought: false });
  assert.deepEqual(clampMapLandingZoom(0.6), { zoom: 0.6, recenterThought: false });
  assert.deepEqual(clampMapLandingZoom(0.2), { zoom: 0.55, recenterThought: true });
  assert.deepEqual(clampMapLandingZoom(0.32), { zoom: 0.55, recenterThought: true });
});

test('workUnfoldAt: wide window keeps 0.9; phone unfolds at ~60% viewport card', () => {
  assert.equal(workUnfoldAt(1440), WORK_UNFOLD);
  assert.equal(workUnfoldAt(1024), WORK_UNFOLD);
  assert.equal(workUnfoldAt(390), Math.max(390 * WORK_FIT_FRACTION / 520, 0.48));
  assert.ok(Math.abs(workUnfoldAt(320) - 0.48) < 1e-12);
  assert.ok(workUnfoldAt(390) < 0.55, 'landing 0.55 is already work on a phone');
  assert.ok(workFoldAt(390) < workUnfoldAt(390));
  assert.equal(workFoldAt(1440), WORK_FOLD);
});

test('clampMapLandingZoom on 390px pulls close-up back to landing zoom', () => {
  assert.deepEqual(clampMapLandingZoom(0.8, 390), { zoom: 0.55, recenterThought: false });
  assert.deepEqual(clampMapLandingZoom(0.7, 390), { zoom: 0.55, recenterThought: false });
  assert.deepEqual(clampMapLandingZoom(0.47, 390), { zoom: 0.47, recenterThought: false });
});

test('wheel pan is Mac + fine pointer, not iPhone-as-Mac', () => {
  assert.equal(wheelPanPreferred({ hoverFine: true, pointerCoarse: false, uaMac: true }), true);
  assert.equal(wheelPanPreferred({ hoverFine: true, pointerCoarse: true, uaMac: true }), false);
  assert.equal(wheelPanPreferred({ hoverFine: false, pointerCoarse: true, uaMac: true }), false);
  assert.equal(wheelPanPreferred({ hoverFine: true, pointerCoarse: false, uaMac: false }), false);
});

test('gesturePolicy: viewer and sheet pan the pane, not the node', () => {
  const sheet = gesturePolicy({ sheet: true, coarse: false, isViewer: false, wheelPan: true });
  assert.equal(sheet.panOnDrag, true);
  assert.equal(sheet.selectionOnDrag, false);
  assert.equal(sheet.nodesDraggable, false);
  assert.equal(sheet.initialFitView, false);

  const viewer = gesturePolicy({ sheet: false, coarse: false, isViewer: true, wheelPan: true });
  assert.equal(viewer.panOnDrag, true);
  assert.equal(viewer.selectionOnDrag, false);
  assert.equal(viewer.initialFitView, true);

  const coarseWide = gesturePolicy({ sheet: false, coarse: true, isViewer: false, wheelPan: false });
  assert.equal(coarseWide.panOnDrag, true);
  assert.equal(coarseWide.nodesConnectable, false);

  const desktop = gesturePolicy({ sheet: false, coarse: false, isViewer: false, wheelPan: true });
  assert.deepEqual(desktop.panOnDrag, [1, 2]);
  assert.equal(desktop.selectionOnDrag, true);
  assert.equal(desktop.nodesDraggable, true);
  assert.equal(desktop.panOnScroll, true);
  assert.equal(desktop.zoomOnScroll, false);
  assert.equal(desktop.initialFitView, true);
});

test('nodeDragEnabled: compact map/glyph drag the card; work pans the canvas', () => {
  const phone = { isViewer: false, sheet: true, coarse: true };
  assert.equal(nodeDragEnabled({ ...phone, zoomTier: 'work' }), false);
  assert.equal(nodeDragEnabled({ ...phone, zoomTier: 'map' }), true);
  assert.equal(nodeDragEnabled({ ...phone, zoomTier: 'glyph' }), true);
  assert.equal(nodeDragEnabled({ isViewer: true, sheet: true, coarse: true, zoomTier: 'map' }), false);
  assert.equal(nodeDragEnabled({ isViewer: false, sheet: false, coarse: false, zoomTier: 'work' }), true);
});

test('cardStealsPan: compact work lets the canvas move; desktop and map lock it', () => {
  assert.equal(cardStealsPan({ nodeDrag: false, sheet: true, coarse: true }), false);
  assert.equal(cardStealsPan({ nodeDrag: true, sheet: true, coarse: true }), true);
  assert.equal(cardStealsPan({ nodeDrag: true, sheet: false, coarse: false }), true);
});

test('toolbarRightPx: sheet and closed overlay hug the edge', () => {
  assert.equal(toolbarRightPx(true, true, 520), 16);
  assert.equal(toolbarRightPx(false, false, 520), 16);
  assert.equal(toolbarRightPx(false, true, 520), 544);
});

test('keep-center helper maps screen midpoint through screenToFlow', () => {
  const seen = [];
  const out = worldAtScreenCenter((p) => {
    seen.push(p);
    return { x: p.x * 2, y: p.y * 2 };
  }, { width: 400, height: 200 });
  assert.deepEqual(seen, [{ x: 200, y: 100 }]);
  assert.deepEqual(out, { x: 400, y: 200 });
});
