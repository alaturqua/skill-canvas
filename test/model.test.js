'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readModel, parseModel } = require('../out/model.js');

test('an empty file is a new, empty canvas', () => {
  const { model, error } = readModel('  \n');
  assert.equal(error, undefined);
  assert.deepEqual(model.nodes, []);
});

test('invalid JSON (e.g. merge conflict markers) is reported, not treated as empty', () => {
  const text = '{\n<<<<<<< HEAD\n  "version": 1,\n=======\n  "version": 1,\n>>>>>>> branch\n}';
  const { error } = readModel(text);
  assert.ok(error, 'expected an error');
});

test('JSON that is not a canvas object is reported', () => {
  assert.ok(readModel('[1, 2]').error);
  assert.ok(readModel('"text"').error);
  assert.ok(readModel('null').error);
});

test('a valid canvas reads without error and keeps its last export', () => {
  const text = JSON.stringify({
    version: 1,
    lastExport: { target: 'claude', scope: 'project', files: ['agents/a.md', 7] },
    nodes: [{ id: 'a', kind: 'agent', name: 'A', x: 0, y: 0 }],
    edges: [],
  });
  const { model, error } = readModel(text);
  assert.equal(error, undefined);
  assert.equal(model.nodes.length, 1);
  assert.deepEqual(model.lastExport, { target: 'claude', scope: 'project', files: ['agents/a.md'] });
});

test('parseModel still falls back to an empty canvas for callers that only need a model', () => {
  assert.deepEqual(parseModel('not json').nodes, []);
});
