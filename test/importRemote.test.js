'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseRepo, findInTree, otherRepos } = require('../out/importRemote.js');
const { importFiles } = require('../out/importer.js');

test('repositories are read from owner/repo and github.com links', () => {
  assert.deepEqual(parseRepo('anthropics/skills'), { owner: 'anthropics', repo: 'skills', ref: undefined, dir: undefined });
  assert.deepEqual(parseRepo('https://github.com/anthropics/skills.git'), { owner: 'anthropics', repo: 'skills', ref: undefined, dir: undefined });
  assert.deepEqual(parseRepo('github.com/a/b/tree/main/plugins/review/'), { owner: 'a', repo: 'b', ref: 'main', dir: 'plugins/review' });
  assert.deepEqual(parseRepo('https://github.com/a/b/blob/v2/skills/pdf/SKILL.md'), { owner: 'a', repo: 'b', ref: 'v2', dir: 'skills/pdf' });
  assert.equal(parseRepo('not a repo'), undefined);
  assert.equal(parseRepo('https://gitlab.com/a/b'), undefined);
});

test('agents and skills are found anywhere in a repository', () => {
  const tree = [
    { path: 'skills/pdf/SKILL.md' },
    { path: 'skills/pdf/reference.md', size: 10 },
    { path: 'skills/pdf/scripts/fill.py', size: 10 },
    { path: 'plugins/review/agents/reviewer.md' },
    { path: 'plugins/review/agents/README.md' },
    { path: 'skills/pdf/agents/grader.md' },
    { path: '.github/agents/planner.agent.md' },
    { path: '.github/skills/notes/SKILL.md' },
    { path: 'node_modules/x/skills/y/SKILL.md' },
    { path: 'docs/guide.md' },
  ];
  const found = findInTree(tree);
  assert.deepEqual(found.map((e) => [e.path, e.kind, e.target, e.group]), [
    ['skills/pdf/SKILL.md', 'skill', 'claude', ''],
    ['agents/planner.agent.md', 'agent', 'copilot', '.github'],
    ['skills/notes/SKILL.md', 'skill', 'copilot', '.github'],
    ['agents/reviewer.md', 'agent', 'claude', 'plugins/review'],
  ]);
  assert.deepEqual(found[0].extras.map((x) => x.path), ['reference.md', 'scripts/fill.py', 'agents/grader.md']);
  assert.deepEqual(findInTree(tree, 'plugins/review').map((e) => e.path), ['agents/reviewer.md']);
});

test('a marketplace names plugins kept in other repositories', () => {
  const json = JSON.stringify({ plugins: [
    { name: 'a', source: './plugins/a' },
    { name: 'b', source: { source: 'github', repo: 'other/b' } },
    { name: 'c', source: { source: 'github', repo: 'Me/Market' } },
    { name: 'd', source: { source: 'github', repo: 'other/b' } },
  ] });
  assert.deepEqual(otherRepos(json, { owner: 'me', repo: 'market' }), ['other/b']);
  assert.deepEqual(otherRepos('not json', { owner: 'me', repo: 'market' }), []);
});

test('downloaded files keep their source and never own a project file', () => {
  let n = 0;
  const r = importFiles([{
    path: 'skills/pdf/SKILL.md', kind: 'skill', target: 'claude', scope: 'project', source: 'a/b@1234567:skills/pdf/SKILL.md',
    text: '---\nname: pdf\ndescription: Fills PDF forms. Use when the user has a PDF form.\n---\n\nSteps.',
    extras: [{ path: 'reference.md', text: '# Ref' }],
  }], [], () => `id${++n}`);
  assert.equal(r.nodes[0].source, 'a/b@1234567:skills/pdf/SKILL.md');
  assert.deepEqual(r.nodes[0].references.map((x) => x.path), ['reference.md']);
  assert.deepEqual(r.owned, []);
});
