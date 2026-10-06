import * as vscode from 'vscode';
import { skillFolder } from './importFlow';
import { fileKind, lintFile, SkillFolder } from './lintFile';

/** Wait after typing stops before checking again. */
const DEBOUNCE_MS = 300;

/** How many test scenarios an evals.json holds: the guide's list, or skill-creator's `{ evals: [...] }`. */
function countEvals(text: string | undefined): number | undefined {
  try {
    const json = JSON.parse(text ?? '');
    return Array.isArray(json) ? json.length : Array.isArray(json?.evals) ? json.evals.length : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Shows the best-practice checks from lint.ts as problems in SKILL.md and agent files
 * opened as text, so they help people who don't use the canvas too.
 */
export function registerDiagnostics(context: vscode.ExtensionContext, log: vscode.LogOutputChannel) {
  const collection = vscode.languages.createDiagnosticCollection('skill-canvas');
  const timers = new Map<string, NodeJS.Timeout>();
  const enabled = () => vscode.workspace.getConfiguration('skillCanvas').get<boolean>('lint.enabled', true);

  const check = async (doc: vscode.TextDocument) => {
    const what = fileKind(doc.uri.path);
    if (!what) {
      return;
    }
    if (!enabled()) {
      collection.delete(doc.uri);
      return;
    }
    let folder: SkillFolder | undefined;
    if (what.kind === 'skill' && doc.uri.scheme !== 'untitled') {
      const found = await skillFolder(vscode.Uri.joinPath(doc.uri, '..'));
      const evals = found.find((f) => f.path === 'evals/evals.json');
      folder = {
        files: found.map((f) => f.path),
        references: found.filter((f) => /\.md$/i.test(f.path) && f.text !== undefined).map((f) => ({ path: f.path, content: f.text! })),
        evalCount: evals ? countEvals(evals.text) : 0,
      };
    }
    if (doc.isClosed) {
      return;
    }
    const issues = lintFile(doc.uri.path, doc.getText(), folder) ?? [];
    collection.set(doc.uri, issues.map((i) => {
      const d = new vscode.Diagnostic(
        doc.lineAt(Math.min(i.line, doc.lineCount - 1)).range,
        i.text,
        i.level === 'fix' ? vscode.DiagnosticSeverity.Warning : vscode.DiagnosticSeverity.Information
      );
      d.source = 'Skill Canvas';
      return d;
    }));
  };
  const safeCheck = (doc: vscode.TextDocument) => check(doc).catch((e) => log.error(`Checking ${doc.uri.fsPath} failed: ${e}`));
  const checkSoon = (doc: vscode.TextDocument) => {
    const key = doc.uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      safeCheck(doc);
    }, DEBOUNCE_MS));
  };
  const checkAll = () => vscode.workspace.textDocuments.forEach(safeCheck);

  context.subscriptions.push(
    collection,
    vscode.workspace.onDidOpenTextDocument(safeCheck),
    vscode.workspace.onDidChangeTextDocument((e) => fileKind(e.document.uri.path) && checkSoon(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => collection.delete(doc.uri)),
    vscode.workspace.onDidChangeConfiguration((e) => e.affectsConfiguration('skillCanvas.lint') && checkAll()),
    { dispose: () => timers.forEach(clearTimeout) }
  );
  checkAll();
}
