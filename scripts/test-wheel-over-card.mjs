// Idle card regions must not swallow canvas pan. Run via `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leftoverHorizontalSwipe, overflowConsumesWheel, shouldCancelBrowserSwipe } from '../src/lib/wheel-over-card.ts';

const idle = {
  overflowY: 'auto',
  overflowX: 'visible',
  scrollTop: 0,
  scrollHeight: 40,
  clientHeight: 40,
  scrollLeft: 0,
  scrollWidth: 480,
  clientWidth: 480,
  deltaX: 0,
  deltaY: 40,
};

test('empty follow-up box does not consume a two-finger pan', () => {
  assert.equal(overflowConsumesWheel(idle), false);
});

test('short answer that fits the cap does not consume pan', () => {
  assert.equal(overflowConsumesWheel({ ...idle, scrollHeight: 220, clientHeight: 220 }), false);
});

test('overflowing answer consumes downward scroll when not at the bottom', () => {
  assert.equal(overflowConsumesWheel({
    ...idle,
    scrollHeight: 800,
    clientHeight: 400,
    scrollTop: 0,
    deltaY: 40,
  }), true);
});

test('overflowing answer at the bottom lets the canvas pan onward', () => {
  assert.equal(overflowConsumesWheel({
    ...idle,
    scrollHeight: 800,
    clientHeight: 400,
    scrollTop: 400,
    deltaY: 40,
  }), false);
});

test('overflowing answer still consumes upward scroll away from the top', () => {
  assert.equal(overflowConsumesWheel({
    ...idle,
    scrollHeight: 800,
    clientHeight: 400,
    scrollTop: 200,
    deltaY: -40,
  }), true);
});

function wheel(over = {}) {
  return { ctrlKey: false, metaKey: false, deltaX: 0, deltaY: 0, ...over };
}

test('horizontal trackpad swipe with no scroll target is cancelled (browser back)', () => {
  assert.equal(shouldCancelBrowserSwipe(null, wheel({ deltaX: -40 })), true);
});

test('vertical two-finger pan with no overflow is cancelled so the canvas keeps it', () => {
  assert.equal(shouldCancelBrowserSwipe(null, wheel({ deltaY: 40 })), true);
});

test('pinch is always cancelled so the browser does not page-zoom', () => {
  assert.equal(shouldCancelBrowserSwipe(null, wheel({ deltaY: -40, ctrlKey: true })), true);
});

test('any leftover deltaX on a Y-only scroller is a browser-back swipe', () => {
  const yBox = {
    ...idle,
    overflowY: 'auto',
    overflowX: 'visible',
    scrollHeight: 800,
    clientHeight: 400,
    scrollTop: 0,
    deltaX: -12,
    deltaY: 40,
  };
  assert.equal(overflowConsumesWheel(yBox), true);
  assert.equal(leftoverHorizontalSwipe(yBox), true);
});
