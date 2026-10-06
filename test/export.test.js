'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildExport, readBack, parseFile, foldersToTidy } = require('../out/export.js');
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

const fileFor = (result, nodeId) => result.files.find((f) => f.nodeId === nodeId && (f.kind === 'agent' || f.kind === 'skill')).content;
/** Warnings that must be fixed; tips are advice. */
const fixes = (result) => result.warnings.filter((w) => w.level !== 'tip');
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
  assert.deepEqual(fixes(r), []);
});

test('best-practice checks show on the block and field they are about', () => {
  const m = withLinks();
  m.nodes.find((n) => n.id === 'sk1').name = 'Claude notes';
  const r = buildExport(m, NAME, 'claude');
  assert.ok(r.warnings.some((w) => w.nodeId === 'sk1' && w.field === 'name' && w.level === 'fix'));
  assert.ok(r.warnings.some((w) => w.nodeId === 'ag1' && w.field === 'description' && w.level === 'tip'), '"Fixes bugs" has no "when"');
});

test('an empty description is one thing to fix, not two', () => {
  const r = buildExport(base(), NAME, 'claude');
  assert.equal(r.warnings.filter((w) => w.nodeId === 'ag1' && w.field === 'description').length, 1);
});

test('the workflow description is checked too', () => {
  const m = withLinks();
  m.description = 'I can fix bugs. Use when a bug report comes in.';
  const r = buildExport(m, NAME, 'claude');
  assert.ok(r.warnings.some((w) => !w.nodeId && w.field === 'description' && w.level === 'tip'));
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

test('keys added in the file are kept when reading back and exported again', () => {
  const m = withLinks();
  const text = fileFor(buildExport(m, NAME, 'claude'), 'sk1').replace('---\n\n', 'license: MIT\nmetadata:\n  team: docs\n---\n\n');
  const p = readBack(text, m, 'sk1', NAME, 'claude');
  assert.equal(p.extra, 'license: MIT\nmetadata:\n  team: docs');
  Object.assign(m.nodes.find((n) => n.id === 'sk1'), p);
  assert.match(fileFor(buildExport(m, NAME, 'claude'), 'sk1'), /\nlicense: MIT\nmetadata:\n  team: docs\n---/);
});

const SKILL_SETTINGS = {
  whenToUse: 'When the user mentions release notes.',
  invocation: 'user',
  fork: true,
  forkAgent: 'Explore',
  model: 'haiku',
  effort: 'low',
  paths: 'src/**, docs/*.md',
};
const AGENT_SETTINGS = {
  effort: 'high',
  maxTurns: 10,
  permissionMode: 'plan',
  memory: 'project',
  worktree: true,
  color: 'blue',
  disallowedTools: 'Write, Edit',
};

test('Claude Code settings are written for skills and agents', () => {
  const m = withLinks();
  Object.assign(m.nodes.find((n) => n.id === 'sk1'), SKILL_SETTINGS);
  Object.assign(m.nodes.find((n) => n.id === 'ag1'), AGENT_SETTINGS);
  const r = buildExport(m, NAME, 'claude');
  const s = parseFile(fileFor(r, 'sk1')).fields;
  assert.equal(s.when_to_use, 'When the user mentions release notes.');
  assert.equal(s['disable-model-invocation'], 'true');
  assert.equal(s['user-invocable'], undefined);
  assert.equal(s.context, 'fork');
  assert.equal(s.agent, 'Explore');
  assert.equal(s.model, 'haiku');
  assert.equal(s.effort, 'low');
  assert.deepEqual(s.paths, ['src/**', 'docs/*.md']);
  const a = parseFile(fileFor(r, 'ag1')).fields;
  assert.equal(a.effort, 'high');
  assert.equal(a.maxTurns, '10');
  assert.equal(a.permissionMode, 'plan');
  assert.equal(a.memory, 'project');
  assert.equal(a.isolation, 'worktree');
  assert.equal(a.color, 'blue');
  assert.equal(a.disallowedTools, 'Write, Edit');
});

test('Claude Code settings are left out for Copilot', () => {
  const m = withLinks();
  Object.assign(m.nodes.find((n) => n.id === 'sk1'), SKILL_SETTINGS);
  Object.assign(m.nodes.find((n) => n.id === 'ag1'), AGENT_SETTINGS);
  const r = buildExport(m, NAME, 'copilot');
  assert.deepEqual(Object.keys(parseFile(fileFor(r, 'sk1')).fields), ['name', 'description']);
  assert.deepEqual(Object.keys(parseFile(fileFor(r, 'ag1')).fields), ['name', 'description', 'tools']);
});

test('"only Claude" skills and skills that run on their own read back from the file', () => {
  const text = '---\nname: write-pr-notes\ndescription: Writes notes\nuser-invocable: false\ncontext: fork\nagent: Plan\nmaxTurns: 3\n---\n\nDo it.';
  const p = readBack(text, withLinks(), 'sk1', NAME, 'claude');
  assert.equal(p.invocation, 'claude');
  assert.equal(p.fork, true);
  assert.equal(p.forkAgent, 'Plan');
  assert.equal(p.extra, 'maxTurns: 3', 'not a skill setting, so kept as written');
});

test('settings the canvas cannot show are kept as written', () => {
  const text = '---\nname: write-pr-notes\ndescription: Writes notes\ndisable-model-invocation: true\nuser-invocable: false\ncontext: other\n---\n\nDo it.';
  const p = readBack(text, withLinks(), 'sk1', NAME, 'claude');
  assert.equal(p.invocation, undefined);
  assert.equal(p.fork, undefined);
  assert.equal(p.extra, 'disable-model-invocation: true\nuser-invocable: false\ncontext: other');
});

/** The base canvas with a skill that has extra files and test scenarios. */
function withFiles() {
  const m = withLinks();
  Object.assign(m.nodes.find((n) => n.id === 'sk1'), {
    references: [{ path: 'reference/forms.md', when: 'Read when filling in forms.', content: '# Forms\n\nFill every field.' }],
    evals: [{ query: 'Write notes for PR 12', expected: 'Lists every change\nKeeps it short', files: 'pr-12.diff' }],
  });
  return m;
}

test('extra files are written next to SKILL.md and linked from it, one level deep', () => {
  const r = buildExport(withFiles(), NAME, 'claude');
  const ref = r.files.find((f) => f.path === 'skills/write-pr-notes/reference/forms.md');
  assert.equal(ref.kind, 'reference');
  assert.equal(ref.nodeId, 'sk1');
  assert.equal(ref.content, '# Forms\n\nFill every field.\n');
  assert.match(fileFor(r, 'sk1'), /Write notes\.\n\n## More detail\n\n- \[reference\/forms\.md\]\(reference\/forms\.md\): Read when filling in forms\.\n$/);
});

test('an extra file the instructions already link to is not listed again', () => {
  const m = withFiles();
  m.nodes.find((n) => n.id === 'sk1').prompt = 'Write notes. For forms, see [the guide](reference/forms.md).';
  assert.doesNotMatch(fileFor(buildExport(m, NAME, 'claude'), 'sk1'), /More detail/);
});

test('extra files outside the skill folder are not written', () => {
  const m = withFiles();
  m.nodes.find((n) => n.id === 'sk1').references.push({ path: '../../settings.md', content: 'x' }, { path: 'SKILL.md', content: 'x' });
  const r = buildExport(m, NAME, 'claude');
  assert.deepEqual(r.files.filter((f) => f.kind === 'reference').map((f) => f.path), ['skills/write-pr-notes/reference/forms.md']);
  assert.equal(r.warnings.filter((w) => w.nodeId === 'sk1' && w.field === 'references' && w.level !== 'tip').length, 2);
});

test('test scenarios are written as evals/evals.json in the guide’s format', () => {
  const r = buildExport(withFiles(), NAME, 'claude');
  const evals = r.files.find((f) => f.path === 'skills/write-pr-notes/evals/evals.json');
  assert.equal(evals.kind, 'evals');
  assert.deepEqual(JSON.parse(evals.content), [
    { skills: ['write-pr-notes'], query: 'Write notes for PR 12', files: ['pr-12.diff'], expected_behavior: ['Lists every change', 'Keeps it short'] },
  ]);
  assert.ok(r.warnings.some((w) => w.nodeId === 'sk1' && w.field === 'evals' && /2 more/.test(w.text)));
});

test('reading the file back leaves out the generated list of extra files', () => {
  const m = withFiles();
  const p = readBack(fileFor(buildExport(m, NAME, 'claude'), 'sk1'), m, 'sk1', NAME, 'claude');
  assert.equal(p.prompt, 'Write notes.');
  assert.equal(p.references, undefined, 'unchanged');
  const edited = fileFor(buildExport(m, NAME, 'claude'), 'sk1').replace('Read when filling in forms.', 'Read for any form.');
  assert.equal(readBack(edited, m, 'sk1', NAME, 'claude').references[0].when, 'Read for any form.');
});

test('extra file paths are tidied the same way when writing and when reading back', () => {
  const m = withFiles();
  m.nodes.find((n) => n.id === 'sk1').references[0].path = './reference\\forms.md';
  const text = fileFor(buildExport(m, NAME, 'claude'), 'sk1');
  assert.match(text, /- \[reference\/forms\.md\]\(reference\/forms\.md\)/);
  assert.equal(readBack(text, m, 'sk1', NAME, 'claude').prompt, 'Write notes.');
});

test('folders to tidy after removing a file: inside the skill folder, deepest first', () => {
  assert.deepEqual(foldersToTidy('skills/notes/reference/forms.md'), ['skills/notes/reference', 'skills/notes']);
  assert.deepEqual(foldersToTidy('skills/notes/SKILL.md'), ['skills/notes']);
  assert.deepEqual(foldersToTidy('agents/x.md'), []);
});

test('placeholder descriptions say what the block does and when to use it', () => {
  const agent = parseFile(fileFor(buildExport(base(), NAME, 'claude'), 'ag1')).fields;
  assert.equal(agent.description, 'Handles the "Fix & test" step of the loop-example workflow. Use when running loop-example.');
});

test('the old placeholder description is not kept when reading back', () => {
  const m = base();
  const text = fileFor(buildExport(m, NAME, 'claude'), 'ag1').replace(/description: .*/, 'description: Fix & test (from the loop-example workflow).');
  assert.equal(readBack(text, m, 'ag1', NAME, 'claude').description, undefined);
});

test('the default workflow description says when to run it', () => {
  const m = withLinks();
  let r = buildExport(m, NAME, 'claude');
  assert.equal(parseFile(workflowOf(r)).fields.description, 'Runs the loop-example workflow step by step. Use when the user asks to run loop-example.');
  m.nodes.find((n) => n.id === 'in1').prompt = 'A bug report with steps to reproduce.';
  r = buildExport(m, NAME, 'claude');
  assert.equal(
    parseFile(workflowOf(r)).fields.description,
    'Runs the loop-example workflow step by step. Use when the user asks to run loop-example, or gives a bug report with steps to reproduce.'
  );
  assert.ok(!r.warnings.some((w) => !w.nodeId), 'the default needs no tips');
});

test('the workflow starts with a checklist to track progress', () => {
  const r = buildExport(withLinks(), NAME, 'claude');
  const wf = workflowOf(r);
  assert.match(wf, /Copy this checklist and check off each step as you go:\n\n```\n- \[ \] 1\. Start: Bug report\n- \[ \] 2\. Loop: Up to 3 tries\n- \[ \] 3\. Fix & test\n/);
  assert.match(wf, /Follow these steps\. "Go to step N" means continue from that step\./);
  const file = r.files.find((f) => f.kind === 'workflow');
  assert.match(wf.split('\n')[file.steps.ag1], /^3\. \*\*Fix & test\.\*\*/);
});

/** withLinks, plus a Tester agent that Fix & test can hand work to. */
function withHelper() {
  const m = withLinks();
  m.nodes.push({ id: 'ag2', kind: 'agent', name: 'Tester', x: 480, y: 320, description: 'Runs the tests. Use after a fix.', prompt: 'Run the tests.' });
  m.edges.push({ id: 'u3', kind: 'uses', from: 'ag1', to: 'ag2' });
  return m;
}

test('an agent can hand work to the agents it is linked to', () => {
  const r = buildExport(withHelper(), NAME, 'claude');
  const agent = fileFor(r, 'ag1');
  assert.match(agent, /tools: Read, Edit, Bash, Agent\n/);
  assert.match(agent, /You fix bugs\.\n\nHand work to these agents when it helps: `tester`\.\n$/);
  assert.ok(r.files.some((f) => f.path === 'agents/tester.md'));
  assert.equal(r.steps.ag2, undefined, 'a helper agent is not a step of the workflow');
});

test('an agent with all tools can already hand work on; only the agents are named', () => {
  const m = withHelper();
  m.edges = m.edges.filter((e) => e.to !== 'tl1');
  Object.assign(m.nodes.find((n) => n.id === 'ag1'), { toolsMode: 'all', tools: undefined });
  const agent = fileFor(buildExport(m, NAME, 'claude'), 'ag1');
  assert.doesNotMatch(agent, /^tools:/m);
  assert.match(agent, /Hand work to these agents when it helps: `tester`\./);
});

test('reading back leaves out what agent links add', () => {
  const m = withHelper();
  const p = readBack(fileFor(buildExport(m, NAME, 'claude'), 'ag1'), m, 'ag1', NAME, 'claude');
  assert.equal(p.prompt, 'You fix bugs.');
  assert.equal(p.tools, 'Read, Edit');
});

test('a single agent exports without a workflow command', () => {
  const r = buildExport(
    { version: 1, nodes: [{ id: 'a', kind: 'agent', name: 'Helper', x: 0, y: 0, description: 'd', prompt: 'p' }], edges: [] },
    'x',
    'claude'
  );
  assert.equal(r.files.length, 1);
  assert.equal(r.command, undefined);
  assert.deepEqual(fixes(r), []);
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
