import * as path from 'path';
import * as vscode from 'vscode';
import { buildExport, readBack, ROOTS } from './export';
import type { ExportSummary } from './extension';
import { CanvasModel, parseModel } from './model';

export class CanvasEditorProvider implements vscode.CustomTextEditorProvider {
  static readonly viewType = 'skillCanvas.editor';

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel
  ) {}

  resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel): void {
    this.log.info(`Opening ${document.uri.fsPath}`);
    const mediaRoot = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    panel.webview.options = { enableScripts: true, localResourceRoots: [mediaRoot] };
    panel.webview.html = this.html(panel.webview, mediaRoot);

    // Text last written by the webview, so we don't echo our own edits back.
    let lastFromWebview: string | undefined;

    const push = () => panel.webview.postMessage({ type: 'load', model: parseModel(document.getText()) });

    const apply = async (model: CanvasModel) => {
      const text = JSON.stringify(model, null, 2);
      if (text === document.getText()) {
        return;
      }
      lastFromWebview = text;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), text);
      await vscode.workspace.applyEdit(edit);
    };

    const changeSub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && document.getText() !== lastFromWebview) {
        push();
      }
    });

    const msgSub = panel.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case 'ready':
          this.log.info('Webview ready');
          push();
          break;
        case 'edit':
          await apply(msg.model);
          break;
        case 'analyze':
          panel.webview.postMessage(this.analyze(msg.model, msg.nodeId, document.uri));
          break;
        case 'readback': {
          const model: CanvasModel = msg.model;
          const patch = readBack(msg.text, model, msg.nodeId, path.basename(document.uri.fsPath, '.skillcanvas'), model.target ?? 'claude');
          // Messages are sent as JSON, which drops undefined; null marks a cleared field.
          const cleared = patch && Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? null]));
          panel.webview.postMessage({ type: 'patch', nodeId: msg.nodeId, patch: cleared ?? null });
          break;
        }
        case 'export': {
          // Save the latest canvas first, so the export sees every keystroke.
          await apply(msg.model);
          const summary = await vscode.commands.executeCommand<ExportSummary | undefined>('skillCanvas.export', document.uri);
          panel.webview.postMessage({ type: 'exported', summary: summary ?? null });
          break;
        }
        case 'copy':
          await vscode.env.clipboard.writeText(String(msg.text));
          break;
        case 'error':
          this.log.error(`Webview: ${msg.message}`);
          break;
      }
    });

    panel.onDidDispose(() => {
      changeSub.dispose();
      msgSub.dispose();
    });
  }

  /** Warnings, file list and the preview for the selected block (or the workflow). */
  private analyze(model: CanvasModel, nodeId: string | null, uri: vscode.Uri) {
    const target = model.target ?? 'claude';
    const fallbackName = path.basename(uri.fsPath, '.skillcanvas');
    const result = buildExport(model, fallbackName, target);
    const root = ROOTS[target].project;
    const workflow = result.files.find((f) => f.kind === 'workflow');
    const file = nodeId
      ? result.files.find((f) => f.nodeId === nodeId) ?? (workflow?.steps?.[nodeId] !== undefined ? workflow : undefined)
      : workflow ?? result.files[0];
    return {
      type: 'analysis',
      nodeId,
      fallbackName,
      command: result.command ?? null,
      label: ROOTS[target].label,
      names: result.names,
      warnings: result.warnings,
      files: result.files.map((f) => ({ path: `${root}/${f.path}`, kind: f.kind, nodeId: f.nodeId ?? null })),
      preview: file
        ? {
            path: `${root}/${file.path}`,
            content: file.content,
            kind: file.kind,
            editable: file.kind !== 'workflow' && file.nodeId === nodeId,
            line: nodeId ? file.steps?.[nodeId] ?? null : null,
          }
        : null,
    };
  }

  private html(webview: vscode.Webview, mediaRoot: vscode.Uri): string {
    const script = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'canvas.js'));
    const style = webview.asWebviewUri(vscode.Uri.joinPath(mediaRoot, 'canvas.css'));
    const nonce = Array.from({ length: 16 }, () => Math.floor(Math.random() * 36).toString(36)).join('');
    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="${style}" rel="stylesheet">
  <title>Skill Canvas</title>
</head>
<body>
${ICONS}
  <header id="topbar">
    <div class="wf">
      <input id="wf-name" class="wf-name" aria-label="Workflow name" spellcheck="false" autocomplete="off">
      <button id="wf-command" class="chip" type="button" hidden></button>
    </div>
    <p id="status" class="status" role="status"></p>
    <div class="bar-actions">
      <div id="target" class="segmented" role="radiogroup" aria-label="Export for">
        <button type="button" role="radio" data-target="claude">Claude Code</button>
        <button type="button" role="radio" data-target="copilot">GitHub Copilot</button>
      </div>
      <button id="issues" class="ghost" type="button" aria-haspopup="dialog" aria-expanded="false"></button>
      <button id="export" class="primary" type="button"><svg class="icon" aria-hidden="true"><use href="#i-export"/></svg><span>Export</span></button>
      <button id="toggle-props" class="icon-button" type="button" aria-pressed="true" aria-label="Details panel" title="Show or hide the details panel"><svg class="icon" aria-hidden="true"><use href="#i-panel"/></svg></button>
    </div>
    <div id="issues-list" class="popover" role="dialog" aria-label="Things to fix" hidden></div>
  </header>
  <main id="workspace">
    <aside id="palette" aria-label="Add blocks">
      <h2 class="palette-title">Add blocks</h2>
      <div id="palette-items"></div>
      <details class="shortcuts">
        <summary>Keyboard shortcuts</summary>
        <dl>
          <dt>Delete</dt><dd>Remove the selected block or connection</dd>
          <dt>F2</dt><dd>Rename the selected block</dd>
          <dt>Arrow keys</dt><dd>Move the selected block (Shift for bigger steps)</dd>
          <dt>+ and &minus;</dt><dd>Zoom in and out</dd>
          <dt>0</dt><dd>Fit everything on screen</dd>
          <dt>Space + drag</dt><dd>Move around the canvas</dd>
          <dt>Escape</dt><dd>Clear the selection</dd>
        </dl>
      </details>
    </aside>
    <section id="stage" aria-label="Canvas">
      <svg id="canvas" tabindex="0" role="group" aria-label="Workflow canvas. Press Tab to move between blocks.">
        <defs>
          <pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" class="grid-dot"/></pattern>
          <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" class="arrow-head"/></marker>
          <marker id="arrow-sel" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" class="arrow-head selected"/></marker>
        </defs>
        <rect class="grid-bg" width="100%" height="100%" fill="url(#grid)"/>
        <g id="viewport"><g id="edges"></g><g id="nodes"></g></g>
      </svg>
      <div id="empty" class="empty" hidden>
        <div class="empty-card">
          <h2>Start a workflow</h2>
          <p>Pick a starter, or drag blocks in from the left.</p>
          <div class="starters">
            <button type="button" data-starter="agent"><svg class="glyph k-agent" aria-hidden="true"><use href="#i-agent"/></svg><span><strong>Single agent</strong><span>An agent that handles one kind of request</span></span></button>
            <button type="button" data-starter="skill"><svg class="glyph k-skill" aria-hidden="true"><use href="#i-skill"/></svg><span><strong>Agent with a skill</strong><span>An agent that follows a reusable playbook</span></span></button>
            <button type="button" data-starter="retry"><svg class="glyph k-loop" aria-hidden="true"><use href="#i-loop"/></svg><span><strong>Try until it works</strong><span>Do the work, check it, and retry up to 3 times</span></span></button>
          </div>
        </div>
      </div>
      <div class="zoom" role="toolbar" aria-label="Zoom">
        <button type="button" data-zoom="out" aria-label="Zoom out" title="Zoom out (&minus;)"><svg class="icon" aria-hidden="true"><use href="#i-minus"/></svg></button>
        <button type="button" data-zoom="reset" id="zoom-level" aria-label="Reset zoom to 100%" title="Reset zoom">100%</button>
        <button type="button" data-zoom="in" aria-label="Zoom in" title="Zoom in (+)"><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg></button>
        <button type="button" data-zoom="fit" aria-label="Fit everything on screen" title="Fit everything (0)"><svg class="icon" aria-hidden="true"><use href="#i-fit"/></svg></button>
      </div>
    </section>
    <aside id="props" aria-label="Details"></aside>
  </main>
  <div id="announce" class="sr-only" aria-live="polite"></div>
  <script nonce="${nonce}" src="${script}"></script>
</body>
</html>`;
  }
}

/** One icon set: 16px grid, 1.5 stroke, round joins, drawn in currentColor. */
const ICONS = `  <svg class="icon-defs" aria-hidden="true" focusable="false">
    <defs>
      <symbol id="i-input" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2.5v7M5 6.5l3 3 3-3"/><path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10"/></symbol>
      <symbol id="i-output" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 9.5v-7M5 5.5l3-3 3 3"/><path d="M2.5 10v2.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10"/></symbol>
      <symbol id="i-agent" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="11" height="8.5" rx="2.5"/><path d="M8 5V2.5M6 9v.5M10 9v.5"/></symbol>
      <symbol id="i-skill" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12.5v-9A1.5 1.5 0 0 1 4.5 2H13v9.5H4.5A1.5 1.5 0 0 0 3 13a1 1 0 0 0 1 1h9"/><path d="M6 5.5h4"/></symbol>
      <symbol id="i-tool" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9.8 2.7a3.2 3.2 0 0 0-3.9 4L2.7 9.9a1.6 1.6 0 1 0 2.3 2.3l3.2-3.2a3.2 3.2 0 0 0 4-3.9L10.4 7l-1.8-.4-.4-1.8z"/></symbol>
      <symbol id="i-if" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8h3.5l2.5-4h5M8.5 12H13.5M6 8l2.5 4"/><path d="M11.5 2l2 2-2 2M11.5 10l2 2-2 2"/></symbol>
      <symbol id="i-loop" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13 7a5 5 0 0 0-9-2.5M3 9a5 5 0 0 0 9 2.5"/><path d="M4 2v2.5h2.5M12 14v-2.5H9.5"/></symbol>
      <symbol id="i-workflow" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="6" width="4" height="4" rx="1"/><rect x="10.5" y="2" width="4" height="4" rx="1"/><rect x="10.5" y="10" width="4" height="4" rx="1"/><path d="M5.5 8H8m0 0V5a1 1 0 0 1 1-1h1.5M8 8v3a1 1 0 0 0 1 1h1.5"/></symbol>
      <symbol id="i-export" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.5 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h3"/><path d="M7 8h7M11 5l3 3-3 3"/></symbol>
      <symbol id="i-warning" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7.1 2.6 1.9 12a1 1 0 0 0 .9 1.5h10.4a1 1 0 0 0 .9-1.5L8.9 2.6a1 1 0 0 0-1.8 0z"/><path d="M8 6.5v3M8 11.5v.01"/></symbol>
      <symbol id="i-check" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8.5 6.5 12 13 4.5"/></symbol>
      <symbol id="i-plus" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M8 3v10M3 8h10"/></symbol>
      <symbol id="i-minus" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M3 8h10"/></symbol>
      <symbol id="i-fit" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10"/></symbol>
      <symbol id="i-panel" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="2" y="3" width="12" height="10" rx="1.5"/><path d="M10 3v10"/></symbol>
      <symbol id="i-copy" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></symbol>
      <symbol id="i-trash" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5h11M6.5 4.5V3h3v1.5M4 4.5l.7 9h6.6l.7-9"/></symbol>
      <symbol id="i-close" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></symbol>
      <symbol id="i-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4l4 4-4 4"/></symbol>
    </defs>
  </svg>`;
