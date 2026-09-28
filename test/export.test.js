'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildExport, readBack } = require('../out/export.js');
const { parseModel } = require('../out/model.js');

// Input -> Loop (body) -> Agent -> If; yes -> Output, no -> back into the Loop; Loop done -> Output.
const BASE = {
  version: 1,
  nodes: [
    { id: 'in1', kind: 'input', name: 'Bug report', x: 0, y: 96 },
    { id: 'lp1', kind: 'loop', name: 'Up to 3 tries', x: 240, y: 96, maxIterations: 3 },
    { id: 'ag1', kind: 'agent', name: 'Fix & test', x: 480, y: 32 },
    { id: 'if1', kind: 'if', name: 'Tests pass?', x: 720, y: 32, condition: 'All tests pass' },
    { id: 'out1', kind: 'output', name: 'Pull request', x: 960, y: 8 },
    { id: 'out2', kind: 'output', name: 'Escalate', x: 480, y: 208 },
  ],
  edges: [
    { id: 'e1', from: 'in1', fromPort: 'out', to: 'lp1' },
    { id: 'e2', from: 'lp1', fromPort: 'body', to: 'ag1' },
    { id: 'e3', from: 'ag1', fromPort: 'out', to: 'if1' },
    { id: 'e4', from: 'if1', fromPort: 'true', to: 'out1' },
    { id: 'e5', from: 'if1', fromPort: 'false', to: 'lp1' },
    { id: 'e6', from: 'lp1', fromPort: 'done', to: 'out2' },
  ],
};

const NAME = 'loop-example';

/** A fresh copy of the base canvas, parsed the same way the editor reads a file. */
const base = () => parseModel(JSON.stringify(BASE));

/** The base canvas with a filled-in agent that uses a skill and a tool. */
function withLinks() {
  const m = base();
  Object.assign(m.nodes.find((n) => n.id === 'ag1'), {
    description: 'Fixes bugs',
    prompt: 'You fix bugs.',
    toolsMode: 'only',
    tools: 'Read, Edit',
  });
  m.nodes.push({ id: 'sk1', kind: 'skill', name: 'Write PR notes', x: 720, y: 208, description: 'Writes notes', prompt: 'Write notes.' });
  m.nodes.push({ id: 'tl1', kind: 'tool', name: 'Bash', x: 720, y: 320 });
  m.edges.push({ id: 'u1', kind: 'uses', from: 'ag1', to: 'sk1' }, { id: 'u2', kind: 'uses', from: 'ag1', to: 'tl1' });
  return m;
}

const fileFor = (result, nodeId) => result.files.find((f) => f.nodeId === nodeId).content;
const workflowOf = (result) => result.files.find((f) => f.kind === 'workflow').content;

test('uses links become agent tools and skills, not steps', () => {
  const r = buildExport(withLinks(), NAME, 'claude');
  const agent = fileFor(r, 'ag1');
  assert.match(agent, /tools: Read, Edit, Bash/);
  assert.match(agent, /skills:\n  - write-pr-notes/);
  const wf = workflowOf(r);
  assert.doesNotMatch(wf, /Write PR notes/);
  assert.doesNotMatch(wf, /Tool: Bash/);
  assert.equal(r.command, '/loop-example');
  assert.deepEqual(r.warnings, []);
});

test('unchanged agent file reads back to the same fields', () => {
  const m = withLinks();
  const text = fileFor(buildExport(m, NAME, 'claude'), 'ag1');
  const p = readBack(text, m, 'ag1', NAME, 'claude');
  assert.equal(p.name, undefined);
  assert.equal(p.description, 'Fixes bugs');
  assert.equal(p.tools, 'Read, Edit'); // linked Bash stays a link
  assert.equal(p.toolsMode, 'only');
  assert.equal(p.skills, undefined); // linked skill stays a link
  assert.equal(p.prompt, 'You fix bugs.');
});

test('edited agent file updates description, tools, model and instructions', () => {
  const m = withLinks();
  const text = [
    '---',
    'name: fix-test',
    'description: "Fixes bugs: carefully"',
    'tools: Read, Grep, Bash',
    'model: opus',
    'skills:',
    '  - write-pr-notes',
    '  - code-standards',
    '---',
    '',
    'Step one.',
    '',
    'Step two.',
  ].join('\n');
  const p = readBack(text, m, 'ag1', NAME, 'claude');
  assert.equal(p.description, 'Fixes bugs: carefully');
  assert.equal(p.tools, 'Read, Grep');
  assert.equal(p.model, 'opus');
  assert.equal(p.skills, 'code-standards');
  assert.equal(p.prompt, 'Step one.\n\nStep two.');
});

test('renaming in the file renames the block; placeholder text is not kept', () => {
  const bare = base();
  const text = fileFor(buildExport(bare, NAME, 'claude'), 'ag1').replace('name: fix-test', 'name: bug-fixer');
  const p = readBack(text, bare, 'ag1', NAME, 'claude');
  assert.equal(p.name, 'bug-fixer');
  assert.equal(p.description, undefined);
  assert.equal(p.prompt, undefined);
  assert.equal(p.toolsMode, 'all');
});

test('copilot: skills note is stripped when reading back', () => {
  const m = withLinks();
  const text = fileFor(buildExport(m, NAME, 'copilot'), 'ag1');
  assert.match(text, /When it helps, use these skills: `write-pr-notes`/);
  assert.match(text, /tools:\n  - Read\n  - Edit\n  - Bash/);
  const p = readBack(text, m, 'ag1', NAME, 'copilot');
  assert.equal(p.prompt, 'You fix bugs.');
  assert.equal(p.tools, 'Read, Edit');
});

test('skill file reads back argument hint and allowed tools', () => {
  const text =
    '---\nname: write-pr-notes\ndescription: Writes notes\nargument-hint: "[pr]"\nallowed-tools: Read, Bash(git:*)\n---\n\n# Notes\n\nDo it.';
  const p = readBack(text, withLinks(), 'sk1', NAME, 'claude');
  assert.equal(p.argumentHint, '[pr]');
  assert.equal(p.tools, 'Read, Bash(git:*)');
  assert.equal(p.prompt, '# Notes\n\nDo it.');
});

test('a single agent exports without a workflow command', () => {
  const r = buildExport(
    { version: 1, nodes: [{ id: 'a', kind: 'agent', name: 'Helper', x: 0, y: 0, description: 'd', prompt: 'p' }], edges: [] },
    'x',
    'claude'
  );
  assert.equal(r.files.length, 1);
  assert.equal(r.command, undefined);
  assert.deepEqual(r.warnings, []);
});

test('unconnected blocks are left out with a warning', () => {
  const x = base();
  x.nodes.push({ id: 'lone', kind: 'if', name: 'Stray', x: 0, y: 400 });
  const r = buildExport(x, NAME, 'claude');
  assert.ok(r.warnings.some((w) => w.nodeId === 'lone' && /Not connected/.test(w.text)));
  assert.doesNotMatch(workflowOf(r), /Stray/);
});

test('a loop without an input block still becomes steps', () => {
  const x = base();
  x.nodes = x.nodes.filter((n) => n.id !== 'in1');
  x.edges = x.edges.filter((e) => e.from !== 'in1');
  const wf = workflowOf(buildExport(x, NAME, 'claude'));
  assert.match(wf, /1\. \*\*Loop: Up to 3 tries\.\*\*/);
});

test('loop without a limit warns on its field', () => {
  const x = base();
  delete x.nodes.find((n) => n.id === 'lp1').maxIterations;
  const r = buildExport(x, NAME, 'claude');
  assert.ok(r.warnings.some((w) => w.nodeId === 'lp1' && w.field === 'maxIterations'));
});
