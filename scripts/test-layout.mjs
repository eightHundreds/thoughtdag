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
  insertNodeLocally,
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

test('a measured folded card is not shrunk to the 80px chrome guess', () => {
  const n = thought({
    data: { isCollapsed: true },
    measured: { width: 520, height: 148 },
    height: 148,
  });
  assert.equal(occupancyHeight(n), 148);
});

test('an expanded stamp on a folded card falls back to the folded estimate', () => {
  const n = thought({
    data: { isCollapsed: true },
    measured: { width: 520, height: 540 },
    height: 540,
  });
  assert.equal(occupancyHeight(n), 140);
});

function edge(source, target, extra = {}) {
  return { id: `${source}->${target}`, source, target, data: extra };
}

test('follow-up sits under the parent; a stranger tree keeps its seat', () => {
  const parent = thought({ id: 'p', position: { x: 100, y: 40 }, measured: { width: 520, height: 220 }, height: 220 });
  const stranger = thought({ id: 's', position: { x: 2000, y: 80 }, measured: { width: 520, height: 300 }, height: 300 });
  const child = thought({ id: 'c', position: { x: 0, y: 0 } });
  const nodes = insertNodeLocally(
    [parent, stranger, child],
    [edge('p', 'c')],
    'c',
    { parentId: 'p' },
  );
  const c = nodes.find((n) => n.id === 'c');
  const s = nodes.find((n) => n.id === 's');
  const p = nodes.find((n) => n.id === 'p');
  assert.equal(c.position.x, 100);
  assert.ok(c.position.y >= p.position.y + 220);
  assert.deepEqual(s.position, { x: 2000, y: 80 });
});

test('a second answer lands in the next column; the first child does not move', () => {
  const parent = thought({ id: 'p', position: { x: 0, y: 0 }, measured: { width: 520, height: 200 }, height: 200 });
  const first = thought({ id: 'a', position: { x: 0, y: 280 }, measured: { width: 520, height: 200 }, height: 200 });
  const second = thought({ id: 'b', position: { x: 0, y: 0 } });
  const nodes = insertNodeLocally(
    [parent, first, second],
    [edge('p', 'a'), edge('p', 'b')],
    'b',
    { parentId: 'p' },
  );
  const a = nodes.find((n) => n.id === 'a');
  const b = nodes.find((n) => n.id === 'b');
  assert.deepEqual(a.position, { x: 0, y: 280 });
  assert.ok(b.position.x > a.position.x);
});

test('an explore branch goes to the side, not under the parent', () => {
  const parent = thought({ id: 'p', position: { x: 40, y: 10 }, measured: { width: 520, height: 200 }, height: 200 });
  const branch = thought({ id: 'b', position: { x: 0, y: 0 } });
  const nodes = insertNodeLocally(
    [parent, branch],
    [edge('p', 'b', { isBranchFromSelection: true })],
    'b',
    { parentId: 'p', branch: true },
  );
  const b = nodes.find((n) => n.id === 'b');
  assert.ok(b.position.x > 40);
  assert.ok(b.position.y < 10 + 200);
});

