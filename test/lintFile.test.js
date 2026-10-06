'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lintFile, fileKind } = require('../out/lintFile.js');

test('which files are checked: skills, Claude Code agents and Copilot agents', () => {
  assert.deepEqual(fileKind('/p/.claude/skills/pdf/SKILL.md'), { kind: 'skill', target: 'claude', folder: 'pdf' });
  assert.deepEqual(fileKind('C:\\p\\.github\\skills\\pdf\\SKILL.md'), { kind: 'skill', target: 'copilot', folder: 'pdf' });
  assert.deepEqual(fileKind('/home/me/.copilot/skills/pdf/SKILL.md'), { kind: 'skill', target: 'copilot', folder: 'pdf' });
  assert.deepEqual(fileKind('/p/plugin/skills/pdf/SKILL.md'), { kind: 'skill', target: 'claude', folder: 'pdf' });
  assert.deepEqual(fileKind('/p/.claude/agents/review/security.md'), { kind: 'agent', target: 'claude' });
  assert.deepEqual(fileKind('/p/.github/agents/planner.agent.md'), { kind: 'agent', target: 'copilot' });
  assert.equal(fileKind('/p/docs/agents/notes.md'), undefined);
  assert.equal(fileKind('/p/README.md'), undefined);
  assert.equal(lintFile('/p/README.md', '# Hi'), undefined);
});

test('skill issues point at the line of the key they are about', () => {
  const text = '---\nname: Claude-Tools\ndescription: I can help with PDF files. Use when the user mentions PDFs.\n---\n\nUse pdfplumber.';
  const found = lintFile('/p/.claude/skills/pdf/SKILL.md', text);
  assert.ok(found.some((i) => i.line === 1 && i.level === 'fix'), 'name');
  assert.ok(found.some((i) => i.line === 2 && i.level === 'tip'), 'first person description');
  assert.ok(found.some((i) => i.line === 1 && i.level === 'tip' && /folder "pdf"/.test(i.text)), 'name differs from folder');
});

test('body issues point at the first line of the instructions', () => {
  const text = '---\nname: pdf\ndescription: Extracts text from PDF files. Use when the user mentions PDFs.\n---\n\nRun scripts\\fill.py.';
  const found = lintFile('/p/.claude/skills/pdf/SKILL.md', text);
  assert.deepEqual(found.map((i) => [i.line, i.level]), [[5, 'tip']]);
});

test('what is in the skill folder is checked when it is known', () => {
  const text = '---\nname: pdf\ndescription: Extracts text from PDF files. Use when the user mentions PDFs.\n---\n\nSee [forms](reference/forms.md) and [fill](scripts/fill.py).';
  const found = lintFile('/p/.claude/skills/pdf/SKILL.md', text, {
    files: ['reference/forms.md'],
    references: [{ path: 'reference/forms.md', content: 'line\n'.repeat(120) }],
    evalCount: 0,
  });
  assert.ok(found.some((i) => /scripts\/fill\.py/.test(i.text)));
  assert.ok(found.some((i) => /reference\/forms\.md is over 100 lines/.test(i.text)));
  assert.ok(found.some((i) => /3 more test scenarios/.test(i.text)));
});

test('agent settings are checked; files without a name are documentation and skipped', () => {
  const text = '---\nname: reviewer\ndescription: Reviews code. Use after code changes.\npermissionMode: yolo\n---\n\nYou review.';
  assert.deepEqual(lintFile('/p/.claude/agents/reviewer.md', text).map((i) => [i.line, i.level]), [[3, 'fix']]);
  assert.deepEqual(lintFile('/p/.claude/agents/README.md', '# About our agents'), []);
});

test('a missing description is reported on the first line', () => {
  assert.deepEqual(lintFile('/p/.claude/skills/pdf/SKILL.md', '---\nname: pdf\n---\n\nDo it.').map((i) => [i.line, i.level]), [[0, 'fix']]);
});
