import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectTitleSource, formatTitleSource, sanitizeCanvasTitle } from '../src/lib/canvas-title.ts';

function node(over = {}) {
  const { data, ...rest } = over;
  return {
    id: rest.id ?? 'n',
    type: 'thought',
    position: { x: 0, y: 0 },
    data: {
      question: 'Why save articles unread?',
      response: '',
      responses: [''],
      responseIndex: 0,
      isCollapsed: false,
      isEditing: false,
      isEditingResponse: false,
      isLoading: false,
      tokenCount: 0,
      highlights: [],
      highlightMode: 'off',
      attachments: [],
      excludedAttachmentIds: [],
      includedAttachmentIds: [],
      roleMode: 'inherit',
      isRoot: false,
      isBranch: false,
      ...data,
    },
  };
}

test('skips frames and archived nodes', () => {
  const rows = collectTitleSource([
    node({ id: 'a', data: { question: 'Q1', summaries: ['S1'], responseIndex: 0 } }),
    node({ id: 'f', data: { stepKind: 'frame', question: 'Chapter' } }),
    node({ id: 'z', data: { archived: true, question: 'old', summaries: ['gone'], responseIndex: 0 } }),
  ]);
  assert.deepEqual(rows, [{ question: 'Q1', summary: 'S1' }]);
});

test('keeps a question with no summary', () => {
  const rows = collectTitleSource([node({ data: { question: 'Open question' } })]);
  assert.deepEqual(rows, [{ question: 'Open question' }]);
});

test('formats numbered lines with 摘要', () => {
  const text = formatTitleSource([
    { question: 'Why unread?', summary: 'Saving is cheap' },
    { question: 'Switch tools?' },
  ]);
  assert.equal(text, '1. Why unread?\n   摘要: Saving is cheap\n2. Switch tools?');
});

test('sanitize strips quotes, dashes, extra lines', () => {
  assert.equal(sanitizeCanvasTitle('「收藏错觉」\nmore'), '收藏错觉');
  assert.equal(sanitizeCanvasTitle('"Collector fallacy — unread"'), 'Collector fallacy ， unread');
  assert.equal(sanitizeCanvasTitle('   '), '');
});
