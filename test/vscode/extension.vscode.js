'use strict';

// Runs inside VS Code (npm run test:vscode), for the parts the unit tests can't reach:
// problems in the text editor, reading a skill's folder, tidying folders, the canvas editor.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vscode = require('vscode');

const EXT = 'alaturqua.skill-canvas';
let tmp;
let ext;

/** Waits until `check` returns something truthy, or fails after `ms`. */
async function until(check, ms = 10000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error('Timed out waiting');
    await new Promise((r) => setTimeout(r, 100));
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function write(rel, text) {
  const file = path.join(tmp, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return vscode.Uri.file(file);
}

// Only ours: VS Code itself also checks some agent and skill files.
const problems = (uri, severity) =>
  vscode.languages.getDiagnostics(uri).filter((d) => d.source === 'Skill Canvas' && (severity === undefined || d.severity === severity));
const { Warning, Information } = vscode.DiagnosticSeverity;

suite('Skill Canvas in VS Code', () => {
  suiteSetup(async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-canvas-'));
    ext = vscode.extensions.getExtension(EXT);
    await ext.activate();
  });

  suiteTeardown(async () => {
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await vscode.workspace.getConfiguration('skillCanvas').update('lint.enabled', undefined, vscode.ConfigurationTarget.Global);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('its commands are registered', async () => {
    const all = await vscode.commands.getCommands(true);
    for (const c of ['skillCanvas.new', 'skillCanvas.export', 'skillCanvas.import']) {
      assert.ok(all.includes(c), c);
    }
  });

  test('a SKILL.md opened as text shows the checks as problems, on the right lines', async () => {
    const uri = write('.claude/skills/pdf/SKILL.md', '---\nname: Claude-Tools\ndescription: I can help with PDF files. Use when the user mentions PDFs.\n---\n\nUse pdfplumber.\n');
    await vscode.window.showTextDocument(uri);
    const found = await until(() => problems(uri).length && problems(uri));
    assert.ok(found.some((d) => d.range.start.line === 1 && d.severity === Warning), 'the name is a thing to fix');
    assert.ok(found.some((d) => d.range.start.line === 2 && d.severity === Information), 'first person is a tip');
  });

  test('problems follow edits', async () => {
    const uri = write('.claude/skills/notes/SKILL.md', '---\nname: notes\ndescription: Writes release notes from merged changes. Use when the user asks for release notes.\n---\n\nList the changes.\n');
    const editor = await vscode.window.showTextDocument(uri);
    await until(() => problems(uri).length); // the tip to add test scenarios
    assert.equal(problems(uri, Warning).length, 0);
    await editor.edit((e) => e.replace(new vscode.Range(1, 6, 1, 11), 'claude-notes'));
    await until(() => problems(uri, Warning).length);
  });

  test('agent files are checked; other Markdown is left alone', async () => {
    const agent = write('.claude/agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews code. Use after code changes.\npermissionMode: yolo\n---\n\nYou review.\n');
    await vscode.window.showTextDocument(agent);
    const found = await until(() => problems(agent, Warning).length && problems(agent, Warning));
    assert.equal(found[0].range.start.line, 3);

    const notes = write('docs/notes.md', '---\nname: Claude Tools\n---\n\nNot a skill.\n');
    await vscode.window.showTextDocument(notes);
    await sleep(1000);
    assert.equal(problems(notes).length, 0);
  });

  test('turning the setting off clears the problems', async () => {
    const uri = vscode.Uri.file(path.join(tmp, '.claude', 'skills', 'pdf', 'SKILL.md'));
    await vscode.workspace.getConfiguration('skillCanvas').update('lint.enabled', false, vscode.ConfigurationTarget.Global);
    await until(() => problems(uri).length === 0);
    await vscode.workspace.getConfiguration('skillCanvas').update('lint.enabled', undefined, vscode.ConfigurationTarget.Global);
    await until(() => problems(uri).length);
  });

  test('importing reads a skill folder: Markdown and test scenarios as text, other files by name', async () => {
    const dir = path.join(tmp, 'import', 'skills', 'forms');
    write('import/skills/forms/SKILL.md', '---\nname: forms\n---\n');
    write('import/skills/forms/reference/fields.md', '# Fields\n');
    write('import/skills/forms/evals/evals.json', '[]');
    write('import/skills/forms/scripts/fill.py', 'print(1)\n');
    write('import/skills/forms/.cache/x.md', 'hidden\n');
    const { skillFolder } = require(path.join(ext.extensionPath, 'out', 'importFlow.js'));
    const found = (await skillFolder(vscode.Uri.file(dir))).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(found, [
      { path: 'evals/evals.json', text: '[]' },
      { path: 'reference/fields.md', text: '# Fields\n' },
      { path: 'scripts/fill.py', text: undefined },
    ]);
  });

  test('removing a skill removes the folders it leaves empty, and keeps the rest', async () => {
    const root = path.join(tmp, 'export');
    fs.mkdirSync(path.join(root, 'skills', 'gone', 'reference'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', 'kept', 'reference'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'kept', 'notes.txt'), 'mine');
    const { removeEmptyFolders } = require(path.join(ext.extensionPath, 'out', 'extension.js'));
    await removeEmptyFolders(vscode.Uri.file(root), [
      'skills/gone/reference/a.md',
      'skills/gone/SKILL.md',
      'skills/kept/reference/b.md',
      'skills/kept/SKILL.md',
    ]);
    assert.equal(fs.existsSync(path.join(root, 'skills', 'gone')), false);
    assert.equal(fs.existsSync(path.join(root, 'skills', 'kept', 'reference')), false);
    assert.equal(fs.readFileSync(path.join(root, 'skills', 'kept', 'notes.txt'), 'utf8'), 'mine');
  });

  test('a .skillcanvas file opens in the canvas editor', async () => {
    const uri = write('flow.skillcanvas', JSON.stringify({ version: 1, nodes: [], edges: [] }));
    await vscode.commands.executeCommand('vscode.openWith', uri, 'skillCanvas.editor');
    const tab = await until(() => {
      const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
      return input instanceof vscode.TabInputCustom && input;
    });
    assert.equal(tab.viewType, 'skillCanvas.editor');
  });
});
