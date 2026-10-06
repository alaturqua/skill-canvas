'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { lintSkill, lintAgent, splitTools } = require('../out/lint.js');

// The guide's own example of a good description.
const GOOD = 'Extracts text and tables from PDF files, fills forms, and merges documents. Use when working with PDF files or when the user mentions PDFs, forms, or document extraction.';
const skill = (over) => ({ name: 'processing-pdfs', description: GOOD, body: 'Use pdfplumber.', target: 'claude', ...over });
const agent = (over) => ({ name: 'code-reviewer', description: 'Reviews code for quality and security. Use proactively after code changes.', target: 'claude', ...over });
const issues = (list, key) => list.filter((i) => !key || i.key === key).map((i) => i.level);

test('a skill that follows the guide has nothing to fix', () => {
  assert.deepEqual(lintSkill(skill({ evalCount: 3, files: [], references: [] })), []);
});

test('an empty description must be filled in', () => {
  assert.deepEqual(issues(lintSkill(skill({ description: '  ' })), 'description'), ['fix']);
});

test('descriptions over 1,024 characters must be shortened', () => {
  assert.deepEqual(issues(lintSkill(skill({ description: `${GOOD} ${'x'.repeat(1024)}` })), 'description'), ['fix']);
});

test('description and when_to_use together over 1,536 characters are cut off in Claude Code', () => {
  const s = skill({ description: GOOD, whenToUse: 'y'.repeat(1500) });
  assert.deepEqual(issues(lintSkill(s), 'when_to_use'), ['fix']);
  assert.deepEqual(issues(lintSkill({ ...s, target: 'copilot' }), 'when_to_use'), []);
});

test('XML tags are not allowed in the description', () => {
  assert.deepEqual(issues(lintSkill(skill({ description: `${GOOD} <b>Bold</b>` })), 'description'), ['fix']);
});

test('a description without a "when to use" cue gets a tip, unless when_to_use says it', () => {
  const s = skill({ description: 'Extracts text and tables from PDF files and merges documents.' });
  assert.deepEqual(issues(lintSkill(s), 'description'), ['tip']);
  assert.deepEqual(issues(lintSkill({ ...s, whenToUse: 'The user mentions PDFs.' }), 'description'), []);
});

test('first and second person descriptions get a tip', () => {
  assert.deepEqual(issues(lintSkill(skill({ description: 'I can help you process Excel files. Use when working with spreadsheets.' })), 'description'), ['tip']);
  assert.deepEqual(issues(lintSkill(skill({ description: 'You can use this to process Excel files. Use when working with spreadsheets.' })), 'description'), ['tip']);
});

test('vague descriptions get a tip', () => {
  assert.ok(lintSkill(skill({ description: 'Helps with documents' })).some((i) => i.key === 'description' && /specific/i.test(i.text)));
});

test('names: only lowercase, digits and hyphens, at most 64 characters, no reserved words', () => {
  assert.deepEqual(issues(lintSkill(skill({ name: 'PDF Tools' })), 'name'), ['fix']);
  assert.deepEqual(issues(lintSkill(skill({ name: 'a'.repeat(65) })), 'name'), ['fix']);
  assert.deepEqual(issues(lintSkill(skill({ name: 'claude-pdf' })), 'name'), ['fix']);
  assert.deepEqual(issues(lintSkill(skill({ name: 'anthropic-helper' })), 'name'), ['fix']);
});

test('vague names and names that differ from the folder get a tip', () => {
  assert.deepEqual(issues(lintSkill(skill({ name: 'helper' })), 'name'), ['tip']);
  assert.deepEqual(issues(lintSkill(skill({ name: 'utils' })), 'name'), ['tip']);
  assert.deepEqual(issues(lintSkill(skill({ folder: 'pdf' })), 'name'), ['tip']);
  assert.deepEqual(issues(lintSkill(skill({ folder: 'processing-pdfs' })), 'name'), []);
});

test('instructions over 500 lines get a tip to move details into extra files', () => {
  assert.deepEqual(issues(lintSkill(skill({ body: 'line\n'.repeat(501) })), 'body'), ['tip']);
  assert.deepEqual(issues(lintSkill(skill({ body: 'line\n'.repeat(400) })), 'body'), []);
});

test('Windows-style paths get a tip', () => {
  assert.deepEqual(issues(lintSkill(skill({ body: 'Run scripts\\helper.py first.' })), 'body'), ['tip']);
  assert.deepEqual(issues(lintSkill(skill({ body: 'Run scripts/helper.py first.' })), 'body'), []);
});

test('time-sensitive instructions get a tip', () => {
  assert.deepEqual(issues(lintSkill(skill({ body: "If you're doing this before August 2025, use the old API." })), 'body'), ['tip']);
});

test('links to files that are not in the skill folder get a tip, when the folder is known', () => {
  const body = 'See [forms](reference/forms.md), run [fill](scripts/fill.py), read [docs](https://example.com) and [top](#top).';
  const found = lintSkill(skill({ body, files: ['reference/forms.md'] })).filter((i) => i.key === 'body');
  assert.equal(found.length, 1);
  assert.match(found[0].text, /scripts\/fill\.py/);
  assert.deepEqual(issues(lintSkill(skill({ body })), 'body'), [], 'folder unknown: nothing to check against');
});

test('long reference files need a contents list; references stay one level deep', () => {
  const long = 'line\n'.repeat(101);
  assert.deepEqual(issues(lintSkill(skill({ references: [{ path: 'reference/api.md', content: long }] })), 'references'), ['tip']);
  assert.deepEqual(issues(lintSkill(skill({ references: [{ path: 'reference/api.md', content: `# API\n\n## Contents\n- Setup\n\n${long}` }] })), 'references'), []);
  assert.deepEqual(issues(lintSkill(skill({ references: [{ path: 'reference/a.md', content: 'See [details](details.md).' }] })), 'references'), ['tip']);
});

test('fewer than three test scenarios get a tip', () => {
  assert.deepEqual(issues(lintSkill(skill({ evalCount: 2 })), 'evals'), ['tip']);
  assert.deepEqual(issues(lintSkill(skill({ evalCount: 3 })), 'evals'), []);
  assert.deepEqual(issues(lintSkill(skill()), 'evals'), [], 'unknown: no tip');
});

test('tool lists: comma or space separated, with patterns and MCP tools', () => {
  assert.deepEqual(splitTools('Read, Bash(git add *) Bash(git commit *),mcp__github__create_issue'), ['Read', 'Bash(git add *)', 'Bash(git commit *)', 'mcp__github__create_issue']);
  const found = lintSkill(skill({ tools: 'Read, Bash(git add *) mcp__github__*, Raed' })).filter((i) => i.key === 'allowed-tools');
  assert.deepEqual(found.map((i) => i.level), ['tip']);
  assert.match(found[0].text, /Raed/);
  assert.deepEqual(issues(lintSkill(skill({ tools: 'search/codebase', target: 'copilot' })), 'allowed-tools'), []);
});

test('models and effort must be values Claude Code accepts', () => {
  for (const ok of ['sonnet', 'opus', 'haiku', 'fable', 'inherit', 'opus[1m]', 'claude-opus-5-5']) {
    assert.deepEqual(issues(lintSkill(skill({ model: ok })), 'model'), [], ok);
  }
  assert.deepEqual(issues(lintSkill(skill({ model: 'gpt-4' })), 'model'), ['fix']);
  assert.deepEqual(issues(lintSkill(skill({ model: 'GPT-5.2', target: 'copilot' })), 'model'), []);
  assert.deepEqual(issues(lintSkill(skill({ effort: 'extreme' })), 'effort'), ['fix']);
});

test('an agent that follows the guide has nothing to fix', () => {
  assert.deepEqual(lintAgent(agent({ tools: 'Read, Grep, Glob, Task', model: 'sonnet', maxTurns: 10, permissionMode: 'plan', memory: 'project', color: 'blue', isolation: 'worktree', effort: 'high' })), []);
});

test('an agent description should say when to delegate', () => {
  assert.deepEqual(issues(lintAgent(agent({ description: 'Reviews code for quality and security.' })), 'description'), ['tip']);
  assert.deepEqual(issues(lintAgent(agent({ description: '' })), 'description'), ['fix']);
});

test('a list of agents after Agent only limits anything in the main session', () => {
  const found = lintAgent(agent({ tools: 'Read, Agent(worker, researcher)' })).filter((i) => i.key === 'tools');
  assert.deepEqual(found.map((i) => i.level), ['tip']);
  assert.match(found[0].text, /claude --agent/);
});

test('agent settings must be values Claude Code accepts', () => {
  assert.deepEqual(issues(lintAgent(agent({ permissionMode: 'yolo' })), 'permissionMode'), ['fix']);
  assert.deepEqual(issues(lintAgent(agent({ memory: 'team' })), 'memory'), ['fix']);
  assert.deepEqual(issues(lintAgent(agent({ color: 'magenta' })), 'color'), ['fix']);
  assert.deepEqual(issues(lintAgent(agent({ isolation: 'docker' })), 'isolation'), ['fix']);
  assert.deepEqual(issues(lintAgent(agent({ maxTurns: '0' })), 'maxTurns'), ['fix']);
  assert.deepEqual(issues(lintAgent(agent({ name: 'team:reviewer' })), 'name'), ['fix']);
  assert.deepEqual(issues(lintAgent(agent({ disallowedTools: 'Wirte' })), 'disallowedTools'), ['tip']);
});
