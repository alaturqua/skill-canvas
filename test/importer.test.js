'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { importFiles, humanize, fileName } = require('../out/importer.js');
const { buildExport, parseFile } = require('../out/export.js');

let n = 0;
const id = () => `id${++n}`;

const reviewer = {
  path: 'agents/code-reviewer.md',
  kind: 'agent',
  target: 'claude',
  scope: 'project',
  text: [
    '---',
    'name: code-reviewer',
    'description: Reviews code for quality. Use after changes.',
    'tools: Read, Grep, Glob',
    'model: sonnet',
    'skills:',
    '  - code-standards',
    '  - security-patterns',
    '---',
    '',
    'You are a code reviewer.',
  ].join('\n'),
};

const standards = {
  path: 'skills/code-standards/SKILL.md',
  kind: 'skill',
  target: 'claude',
  scope: 'project',
  text: '---\nname: code-standards\ndescription: Team coding standards.\nargument-hint: "[file]"\nallowed-tools: Read, Bash(npm run lint:*)\n---\n\n# Standards\n\nKeep functions small.',
};

test('names read naturally but keep their file name', () => {
  assert.equal(humanize('code-reviewer'), 'Code reviewer');
  assert.equal(fileName(standards), 'code-standards');
  assert.equal(fileName({ path: 'agents/x.agent.md', kind: 'agent', text: 'no frontmatter' }), 'x');
});

test('agents and skills become blocks; preloaded skills become uses links', () => {
  const r = importFiles([reviewer, standards], [], id);
  const agent = r.nodes.find((x) => x.kind === 'agent');
  const skill = r.nodes.find((x) => x.kind === 'skill');
  assert.equal(agent.name, 'Code reviewer');
  assert.equal(agent.description, 'Reviews code for quality. Use after changes.');
  assert.equal(agent.tools, 'Read, Grep, Glob');
  assert.equal(agent.toolsMode, 'only');
  assert.equal(agent.model, 'sonnet');
  assert.equal(agent.prompt, 'You are a code reviewer.');
  assert.equal(agent.skills, 'security-patterns', 'skills not on the canvas stay as names');
  assert.deepEqual(r.edges.map((e) => [e.kind, e.from, e.to]), [['uses', agent.id, skill.id]]);
  assert.equal(skill.name, 'Code standards');
  assert.equal(skill.argumentHint, '[file]');
  assert.equal(skill.tools, 'Read, Bash(npm run lint:*)');
  assert.equal(skill.prompt, '# Standards\n\nKeep functions small.');
});

test('a skill already on the canvas gets linked instead of duplicated', () => {
  const existing = [{ id: 'sk', kind: 'skill', name: 'Code standards', x: 0, y: 0 }];
  const r = importFiles([reviewer], existing, id);
  assert.equal(r.nodes.length, 1);
  assert.deepEqual(r.edges.map((e) => e.to), ['sk']);
});

test('files that export back to the same path are owned; renamed ones are not', () => {
  const renamed = { ...reviewer, path: 'agents/reviewer-old.md' };
  const r = importFiles([reviewer, standards, renamed], [], id);
  assert.deepEqual(r.owned.map((o) => o.path).sort(), ['agents/code-reviewer.md', 'skills/code-standards/SKILL.md']);
});

test('Copilot agents: tool lists, model lists and the skills note', () => {
  const agent = {
    path: 'agents/planner.agent.md',
    kind: 'agent',
    target: 'copilot',
    scope: 'user',
    text: "---\ndescription: Plans features\ntools: ['search/codebase', 'web/fetch']\nmodel: ['Claude Opus 4.5', 'GPT-5.2']\n---\n\nPlan first.\n\nWhen it helps, use these skills: `code-standards`.",
  };
  const skill = { ...standards, target: 'copilot', scope: 'user' };
  const r = importFiles([agent, skill], [], id);
  const a = r.nodes.find((x) => x.kind === 'agent');
  assert.equal(a.name, 'Planner');
  assert.equal(a.tools, 'search/codebase, web/fetch');
  // A list of fallback models has no single-model field on the canvas, so it's kept as written.
  assert.equal(a.model, undefined);
  assert.match(buildExport({ version: 1, nodes: [a], edges: [] }, 'x', 'copilot').files[0].content, /\nmodel: \['Claude Opus 4\.5', 'GPT-5\.2'\]\n/);
  assert.equal(a.prompt, 'Plan first.');
  assert.equal(r.edges.length, 1, 'the skill named in the note is linked');
  assert.ok(r.owned.some((o) => o.path === 'agents/planner.agent.md' && o.target === 'copilot'));
});

test('parseFile reads block scalars and multi-line values', () => {
  const { fields } = parseFile(
    '---\nname: x\ndescription: >\n  Extracts text\n  from PDFs.\n\n  Use when asked.\nnotes: |\n  one\n  two\nlong: first\n  second\n---\n\nBody'
  );
  assert.equal(fields.description, 'Extracts text from PDFs.\nUse when asked.');
  assert.equal(fields.notes, 'one\ntwo');
  assert.equal(fields.long, 'first second');
});

test('parseFile keeps each top-level key as written, with its line', () => {
  const text = '---\nname: x\nhooks:\n  PreToolUse:\n    - matcher: "Bash"\ndescription: d\n---\n\nBody';
  const { raw } = parseFile(text);
  assert.deepEqual(raw.map((b) => [b.key, b.line]), [['name', 1], ['hooks', 2], ['description', 5]]);
  assert.equal(raw[1].text, 'hooks:\n  PreToolUse:\n    - matcher: "Bash"');
});

const HOOKS = 'hooks:\n  PreToolUse:\n    - matcher: "Bash"\n      hooks:\n        - type: command\n          command: "./check.sh"';

test('round trip keeps frontmatter the canvas does not show', () => {
  const skill = {
    ...standards,
    text: `---\nname: code-standards\ndescription: >\n  Team coding standards.\n  Use when writing code.\nlicense: MIT\n${HOOKS}\n---\n\n# Standards`,
  };
  const agent = {
    ...reviewer,
    text: '---\nname: code-reviewer\ndescription: Reviews code. Use after changes.\nmcpServers:\n  - github\nmemory: project\n---\n\nYou review.',
  };
  const r = importFiles([skill, agent], [], id);
  const out = buildExport({ version: 1, nodes: r.nodes, edges: r.edges }, 'imported', 'claude');
  const s = parseFile(out.files.find((f) => f.path === 'skills/code-standards/SKILL.md').content);
  assert.equal(s.fields.description, 'Team coding standards. Use when writing code.');
  assert.equal(s.fields.license, 'MIT');
  assert.equal(s.raw.find((b) => b.key === 'hooks').text, HOOKS);
  const a = parseFile(out.files.find((f) => f.path === 'agents/code-reviewer.md').content);
  assert.deepEqual(a.fields.mcpServers, ['github']);
  assert.equal(a.fields.memory, 'project');
});

test('comments in the frontmatter are kept, and do not end up in values', () => {
  const skill = {
    ...standards,
    text: '---\n# Owned by the docs team\nname: code-standards\ndescription: Standards. Use when writing code.\n# Review every quarter\nmodel: sonnet  # fast enough\n---\n\nKeep it small.',
  };
  const s = importFiles([skill], [], id).nodes[0];
  assert.equal(s.model, 'sonnet');
  const out = buildExport({ version: 1, nodes: [s], edges: [] }, 'x', 'claude').files[0].content;
  assert.match(out, /\n# Owned by the docs team\n/);
  assert.match(out, /\n# Review every quarter\n/);
  assert.match(out, /\nmodel: sonnet\n/);
});

test('Claude Code settings import into fields and export back the same', () => {
  const skill = {
    ...standards,
    text: '---\nname: code-standards\ndescription: Standards. Use when writing code.\nwhen_to_use: When reviewing a PR.\ndisable-model-invocation: yes\ncontext: fork\nagent: Explore\nmodel: haiku\neffort: low\npaths:\n  - src/**\n---\n\nKeep it small.',
  };
  const agent = {
    ...reviewer,
    text: '---\nname: code-reviewer\ndescription: Reviews code. Use after changes.\ndisallowedTools: Write\nmodel: sonnet\neffort: high\nmaxTurns: 12\npermissionMode: plan\nmemory: user\nisolation: worktree\ncolor: cyan\n---\n\nYou review.',
  };
  const r = importFiles([skill, agent], [], id);
  const s = r.nodes.find((x) => x.kind === 'skill');
  assert.equal(s.whenToUse, 'When reviewing a PR.');
  assert.equal(s.invocation, 'user');
  assert.equal(s.fork, true);
  assert.equal(s.forkAgent, 'Explore');
  assert.equal(s.model, 'haiku');
  assert.equal(s.effort, 'low');
  assert.equal(s.paths, 'src/**');
  assert.equal(s.extra, undefined);
  const a = r.nodes.find((x) => x.kind === 'agent');
  assert.equal(a.maxTurns, 12);
  assert.equal(a.permissionMode, 'plan');
  assert.equal(a.memory, 'user');
  assert.equal(a.worktree, true);
  assert.equal(a.color, 'cyan');
  assert.equal(a.disallowedTools, 'Write');
  assert.equal(a.effort, 'high');
  assert.equal(a.extra, undefined);
  const out = buildExport({ version: 1, nodes: r.nodes, edges: r.edges }, 'imported', 'claude');
  const sf = parseFile(out.files.find((f) => f.path === 'skills/code-standards/SKILL.md').content).fields;
  assert.equal(sf['disable-model-invocation'], 'true');
  assert.deepEqual(sf.paths, ['src/**']);
  const af = parseFile(out.files.find((f) => f.path === 'agents/code-reviewer.md').content).fields;
  assert.equal(af.maxTurns, '12');
  assert.equal(af.isolation, 'worktree');
});

test('a skill folder: extra .md files, test scenarios and other files', () => {
  const skill = {
    ...standards,
    text: '---\nname: code-standards\ndescription: Standards. Use when writing code.\n---\n\nKeep it small.\n\n## More detail\n\n- [reference/naming.md](reference/naming.md): Read when naming things.',
    extras: [
      { path: 'reference/naming.md', text: '# Naming\n\nSay what it does.\n' },
      { path: 'scripts/check.py' },
      { path: 'evals/evals.json', text: JSON.stringify([{ skills: ['code-standards'], query: 'Review x.ts', files: [], expected_behavior: ['Flags long functions'] }]) },
    ],
  };
  const r = importFiles([skill], [], id);
  const s = r.nodes[0];
  assert.equal(s.prompt, 'Keep it small.');
  assert.deepEqual(s.references, [{ path: 'reference/naming.md', when: 'Read when naming things.', content: '# Naming\n\nSay what it does.' }]);
  assert.deepEqual(s.evals, [{ query: 'Review x.ts', expected: 'Flags long functions' }]);
  assert.deepEqual(s.otherFiles, ['scripts/check.py']);
  assert.deepEqual(r.owned.map((o) => o.path).sort(), [
    'skills/code-standards/SKILL.md',
    'skills/code-standards/evals/evals.json',
    'skills/code-standards/reference/naming.md',
  ]);
  const out = buildExport({ version: 1, nodes: r.nodes, edges: [] }, 'x', 'claude');
  assert.equal(out.files.find((f) => f.kind === 'skill').content, `${skill.text}\n`);
});

test('test scenarios in another format are kept as they are', () => {
  const skill = { ...standards, extras: [{ path: 'evals/evals.json', text: JSON.stringify({ skill_name: 'code-standards', evals: [{ id: 1, prompt: 'p' }] }) }] };
  const s = importFiles([skill], [], id).nodes[0];
  assert.equal(s.evals, undefined);
  assert.deepEqual(s.otherFiles, ['evals/evals.json']);
  const out = buildExport({ version: 1, nodes: [s], edges: [] }, 'x', 'claude');
  assert.ok(!out.files.some((f) => f.kind === 'evals'));
  assert.ok(!out.warnings.some((w) => w.field === 'evals'), 'it has scenarios, just not ones the canvas edits');
});

test('agents named as helpers in the instructions become links between agents', () => {
  const lead = {
    ...reviewer,
    path: 'agents/lead.md',
    text: '---\nname: lead\ndescription: Leads reviews. Use for big changes.\ntools: Read, Agent\n---\n\nSplit the review.\n\nHand work to these agents when it helps: `code-reviewer`.',
  };
  const r = importFiles([lead, reviewer], [], id);
  const a = r.nodes.find((x) => x.name === 'Lead');
  const b = r.nodes.find((x) => x.name === 'Code reviewer');
  assert.equal(a.prompt, 'Split the review.');
  assert.ok(r.edges.some((e) => e.kind === 'uses' && e.from === a.id && e.to === b.id));
});

test('round trip: imported blocks export back to the same files and settings', () => {
  const r = importFiles([reviewer, standards], [], id);
  const out = buildExport({ version: 1, nodes: r.nodes, edges: r.edges }, 'imported', 'claude');
  const agentFile = out.files.find((f) => f.path === 'agents/code-reviewer.md');
  const skillFile = out.files.find((f) => f.path === 'skills/code-standards/SKILL.md');
  assert.ok(agentFile && skillFile, 'same paths');
  const a = parseFile(agentFile.content);
  assert.equal(a.fields.name, 'code-reviewer');
  assert.equal(a.fields.tools, 'Read, Grep, Glob');
  assert.equal(a.fields.model, 'sonnet');
  assert.deepEqual(a.fields.skills, ['code-standards', 'security-patterns']);
  assert.equal(a.body, 'You are a code reviewer.');
  assert.equal(parseFile(skillFile.content).fields['allowed-tools'], 'Read, Bash(npm run lint:*)');
});
