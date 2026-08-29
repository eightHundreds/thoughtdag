// Locks single-user vault decisions: deletes stay deleted, unsynced
// local edits are not discarded. Run via `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideProjectSync, projectHashSource } from '../src/lib/sync-decision.ts';

const base = {
  localExists: true,
  remoteExists: true,
  localHasContent: true,
  lastHash: 'H1',
  localHash: 'H1',
  remoteHash: 'H1',
};

test('same hash on both sides is a no-op', () => {
  assert.equal(decideProjectSync(base), 'same');
});

test('canvas hash source includes the title so a rename is an edit', () => {
  const graph = { nodes: [{ id: 'a' }], edges: [], events: [] };
  const a = projectHashSource(graph, 'My Canvas');
  const b = projectHashSource(graph, 'Renamed');
  assert.equal(a.name, 'My Canvas');
  assert.notDeepEqual(a, b);
  assert.deepEqual(a.nodes, b.nodes);
  assert.equal(decideProjectSync({ ...base, localHash: JSON.stringify(b) }), 'push');
});

test('node deletions on this computer push the smaller graph', () => {
  assert.equal(decideProjectSync({ ...base, localHash: 'H2' }), 'push');
});

test('node deletions on the other computer pull', () => {
  assert.equal(decideProjectSync({ ...base, remoteHash: 'H2' }), 'pull');
});

test('emptying every node on this computer is a push, not a resurrection pull', () => {
  assert.equal(decideProjectSync({
    ...base,
    localHasContent: false,
    localHash: 'EMPTY',
  }), 'push');
});

test('deleting the canvas here removes the remote object', () => {
  assert.equal(decideProjectSync({
    ...base,
    localExists: false,
    localHasContent: false,
    localHash: '',
  }), 'delete-remote');
});

test('a canvas that only exists remotely is pulled (other computer created it)', () => {
  assert.equal(decideProjectSync({
    localExists: false,
    remoteExists: true,
    localHasContent: false,
    lastHash: null,
    localHash: '',
    remoteHash: 'H1',
  }), 'pull');
});

test('other computer deleted it and we did not edit: drop the local copy', () => {
  assert.equal(decideProjectSync({
    ...base,
    remoteExists: false,
    remoteHash: '',
  }), 'delete-local');
});

test('other computer deleted it but we edited since last sync: keep local and re-upload', () => {
  assert.equal(decideProjectSync({
    ...base,
    remoteExists: false,
    remoteHash: '',
    localHash: 'H2',
  }), 'push');
});

test('brand-new local canvas with content is uploaded', () => {
  assert.equal(decideProjectSync({
    localExists: true,
    remoteExists: false,
    localHasContent: true,
    lastHash: null,
    localHash: 'NEW',
    remoteHash: '',
  }), 'push');
});

test('brand-new empty local canvas is not uploaded', () => {
  assert.equal(decideProjectSync({
    localExists: true,
    remoteExists: false,
    localHasContent: false,
    lastHash: null,
    localHash: 'EMPTY',
    remoteHash: '',
  }), 'same');
});

test('first link on an empty local copy adopts the vault (does not fork)', () => {
  assert.equal(decideProjectSync({
    localExists: true,
    remoteExists: true,
    localHasContent: false,
    lastHash: null,
    localHash: 'EMPTY',
    remoteHash: 'H1',
  }), 'pull');
});

test('both sides changed the same canvas: keep remote, fork local', () => {
  assert.equal(decideProjectSync({
    ...base,
    lastHash: 'H0',
    localHash: 'HA',
    remoteHash: 'HB',
  }), 'conflict');
});
