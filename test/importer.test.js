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
  assert.equal(a.model, 'Claude Opus 4.5');
  assert.equal(a.prompt, 'Plan first.');
  assert.equal(r.edges.length, 1, 'the skill named in the note is linked');
  assert.ok(r.owned.some((o) => o.path === 'agents/planner.agent.md' && o.target === 'copilot'));
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
