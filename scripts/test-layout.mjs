// Work-tier wrapper lock/unlock: zoom-out must not stamp the char-count
// estimate onto short cards (that hollow box is what detached edges after
// zoom-in). Run via `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  estimateNodeHeight,
  occupancyHeight,
  lockWorkWrapper,
  unlockWorkWrapper,
} from '../src/lib/occupancy.ts';

function thought(over = {}) {
  const { data, ...rest } = over;
  return {
    id: 'n1',
    type: 'thought',
    position: { x: 0, y: 0 },
    data: {
      question: '你是谁?',
      response: '我是助手。',
      responses: ['我是助手。'],
      responseIndex: 0,
      isCollapsed: false,
      isEditing: false,
      isEditingResponse: false,
      isLoading: false,
      tokenCount: 20,
      highlights: [],
      highlightMode: 'tag',
      attachments: [],
      ...data,
    },
    ...rest,
  };
}

test('short cards estimate taller than a real work box', () => {
  const n = thought({ measured: { width: 520, height: 220 } });
  assert.ok(estimateNodeHeight(n) > 220, 'estimate over-sizes a two-line card');
});

test('occupancy prefers a measured work box over the estimate', () => {
  const n = thought({ measured: { width: 520, height: 220 }, height: 220 });
  assert.equal(occupancyHeight(n), 220);
});

test('leaving work locks occupancy, not the estimate', () => {
  const n = thought({ measured: { width: 520, height: 220 } });
  const locked = lockWorkWrapper(n);
  assert.equal(locked.height, 220);
  assert.ok(locked.height < estimateNodeHeight(n));
});

test('entering work drops the stamped wrapper height so the card can remasure', () => {
  const n = thought({ height: 900, measured: { width: 520, height: 900 } });
  const unlocked = unlockWorkWrapper(n);
  assert.equal(unlocked.height, undefined);
});

test('content nodes keep their user-set size', () => {
  const note = thought({ height: 420, data: { stepKind: 'note' } });
  assert.equal(unlockWorkWrapper(note), note);
  assert.equal(lockWorkWrapper(note), note);
});
