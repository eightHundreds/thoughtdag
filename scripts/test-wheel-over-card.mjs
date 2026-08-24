// Idle card regions must not swallow canvas pan. Run via `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { overflowConsumesWheel } from '../src/lib/wheel-over-card.ts';

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
