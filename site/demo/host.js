// Stands in for the VS Code extension host, so the real Skill Canvas webview can run
// on a web page. Analysis, previews, read-back and import use the extension's own
// code (runtime/export-bundle.js); nothing is written anywhere.
(function () {
  'use strict';
  const X = window.SkillCanvasExport;
  const I = window.SkillCanvasImporter;
  const NAME = 'loop-example';
  // Versioned so a view saved by an earlier demo (which opened with the details panel
  // closed) doesn't carry over.
  const STATE_KEY = 'skill-canvas-demo-2';
  let model = JSON.parse(JSON.stringify(window.DEMO_MODEL));
  let selected = null;

  // Pages opened from disk have an opaque origin, which postMessage can only target as '*'.
  const ORIGIN = location.origin === 'null' ? '*' : location.origin;
  const toCanvas = (msg) => setTimeout(() => window.postMessage(msg, ORIGIN), 0);
  const toPage = (msg) => {
    if (window.parent !== window) window.parent.postMessage(msg, ORIGIN);
  };
  const tellPage = () => toPage({ type: 'skillcanvas:model', model, nodeId: selected });

  // Same result as the extension's CanvasEditorProvider.analyze.
  function analyze(m, nodeId) {
    const target = m.target || 'claude';
    const result = X.buildExport(m, NAME, target);
    const root = X.ROOTS[target].project;
    const workflow = result.files.find((f) => f.kind === 'workflow');
    const file = nodeId
      ? result.files.find((f) => f.nodeId === nodeId) || (workflow && workflow.steps && workflow.steps[nodeId] !== undefined ? workflow : undefined)
      : workflow || result.files[0];
    return {
      type: 'analysis',
      nodeId,
      fallbackName: NAME,
      command: result.command || null,
      label: X.ROOTS[target].label,
      names: result.names,
      steps: result.steps,
      warnings: result.warnings,
      files: result.files.map((f) => ({ path: `${root}/${f.path}`, kind: f.kind, nodeId: f.nodeId || null })),
      preview: file
        ? {
            path: `${root}/${file.path}`,
            content: file.content,
            kind: file.kind,
            editable: file.kind !== 'workflow' && file.nodeId === nodeId,
            line: nodeId && file.steps && file.steps[nodeId] != null ? file.steps[nodeId] : null,
          }
        : null,
    };
  }

  // What Import would find in a project: a small, clearly sample set.
  const SAMPLE = [
    {
      path: 'agents/code-reviewer.md', kind: 'agent', target: 'claude', scope: 'project',
      text: '---\nname: code-reviewer\ndescription: Reviews changes for quality and security. Use after code changes.\ntools: Read, Grep, Glob\nskills:\n  - code-standards\n---\n\nYou review code. Point out problems, show the fix, keep it short.',
    },
    {
      path: 'skills/code-standards/SKILL.md', kind: 'skill', target: 'claude', scope: 'project',
      text: '---\nname: code-standards\ndescription: The team\'s coding standards. Use when writing or reviewing code.\n---\n\nKeep functions small, name things for what they do, and test the edge cases.',
    },
  ];

  window.acquireVsCodeApi = () => ({
    postMessage(msg) {
      switch (msg.type) {
        case 'ready':
          toCanvas({ type: 'load', model });
          tellPage();
          break;
        case 'edit':
          model = msg.model;
          tellPage();
          break;
        case 'analyze':
          model = msg.model;
          selected = msg.nodeId;
          toCanvas(analyze(msg.model, msg.nodeId));
          tellPage();
          break;
        case 'readback': {
          const patch = X.readBack(msg.text, msg.model, msg.nodeId, NAME, msg.model.target || 'claude');
          const cleared = patch && Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v === undefined ? null : v]));
          toCanvas({ type: 'patch', nodeId: msg.nodeId, patch: cleared || null });
          break;
        }
        case 'export': {
          const target = msg.model.target || 'claude';
          const result = X.buildExport(msg.model, NAME, target);
          const files = result.files.map((f) => `${X.ROOTS[target].project}/${f.path}`);
          toCanvas({ type: 'exported', summary: null });
          if (window.parent !== window) {
            toPage({ type: 'skillcanvas:export', files, command: result.command || null, label: X.ROOTS[target].label });
          } else {
            window.alert(`In VS Code, Export saves:\n\n${files.join('\n')}`);
          }
          break;
        }
        case 'import': {
          let n = 0;
          const result = I.importFiles(SAMPLE, model.nodes, () => `demo${Date.now().toString(36)}${++n}`);
          toCanvas({ type: 'imported', targets: SAMPLE.map((f) => f.target), ...result });
          break;
        }
        case 'copy':
          if (navigator.clipboard) navigator.clipboard.writeText(String(msg.text)).catch(() => {});
          break;
        case 'error':
          console.error('[Skill Canvas demo]', msg.message);
          break;
      }
    },
    getState() {
      try {
        return JSON.parse(sessionStorage.getItem(STATE_KEY) || 'null');
      } catch {
        return null;
      }
    },
    setState(state) {
      try {
        sessionStorage.setItem(STATE_KEY, JSON.stringify(state));
      } catch {
        /* storage unavailable: the view just won't be remembered */
      }
    },
  });

  // VS Code puts the theme kind on <body>; the webview styles native controls from it.
  document.addEventListener('DOMContentLoaded', () => document.body.classList.add('vscode-light'));
})();
