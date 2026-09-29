// Assembles the GitHub Pages site into _site/: the static files from site/, plus the
// live demo built from the extension's own webview markup, canvas.js/css and export
// code, and the printouts on the page filled with real files from the sandbox example.
// Run after `npm run compile`.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, '_site');
const require = createRequire(import.meta.url);
const read = (...p) => readFileSync(path.join(root, ...p), 'utf8');

rmSync(out, { recursive: true, force: true });
cpSync(path.join(root, 'site'), out, { recursive: true });

// 1. Runtime: the shipped webview files and a browser bundle of the export code.
const runtime = path.join(out, 'demo', 'runtime');
mkdirSync(runtime, { recursive: true });
for (const f of ['canvas.css', 'canvas.js']) {
  cpSync(path.join(root, 'media', f), path.join(runtime, f));
}
// The page's board is never wide enough for the labelled palette and a readable flow, so
// the demo always uses the editor's own narrow-editor rules, lifted out of their media query.
const COMPACT = '@media (max-width: 1200px) {';
const css = read('media', 'canvas.css');
const at = css.indexOf(COMPACT);
if (at < 0) {
  throw new Error('Could not find the narrow-editor rules in media/canvas.css.');
}
let end = at + COMPACT.length;
for (let depth = 1; end < css.length && depth > 0; end++) {
  if (css[end] === '{') depth++;
  else if (css[end] === '}') depth--;
}
writeFileSync(path.join(runtime, 'compact.css'), `/* From media/canvas.css, ${COMPACT} */\n${css.slice(at + COMPACT.length, end - 1).trim()}\n`);
const modules = { './model': read('out', 'model.js'), './export': read('out', 'export.js'), './importer': read('out', 'importer.js') };
const sources = Object.entries(modules)
  .map(([name, src]) => `${JSON.stringify(name)}: function (exports, require) {\n${src}\n}`)
  .join(',\n');
writeFileSync(
  path.join(runtime, 'export-bundle.js'),
  `// Skill Canvas export and import code (out/model.js, out/export.js, out/importer.js), bundled for the browser.
(function () {
  const sources = {${sources}};
  const cache = {};
  function load(name) {
    if (!cache[name]) {
      const exports = {};
      cache[name] = exports;
      sources[name](exports, load);
    }
    return cache[name];
  }
  window.SkillCanvasExport = load('./export');
  window.SkillCanvasImporter = load('./importer');
})();
`
);

// 2. The demo model: the sandbox example, without its local export record.
const { parseModel } = require(path.join(root, 'out', 'model.js'));
const { buildExport } = require(path.join(root, 'out', 'export.js'));
const model = parseModel(read('sandbox', 'loop-example.skillcanvas'));
delete model.lastExport;
writeFileSync(path.join(out, 'demo', 'model.js'), `window.DEMO_MODEL = ${JSON.stringify(model, null, 2)};\n`);

// 3. The demo page: the extension's real webview markup (CanvasEditorProvider.html),
//    with a CSP for static hosting, the theme, and the stand-in extension host.
const load = Module._load;
Module._load = function (request) {
  return request === 'vscode' ? { Uri: { joinPath: (b, ...p) => ({ fsPath: path.join(b.fsPath, ...p) }) } } : load.apply(this, arguments);
};
const { CanvasEditorProvider } = require(path.join(root, 'out', 'canvasEditor.js'));
Module._load = load;
const provider = new CanvasEditorProvider({ extensionUri: { fsPath: root } }, { info() {}, warn() {}, error() {} });
let demo = provider.html(
  { cspSource: "'self'", asWebviewUri: (u) => `runtime/${path.basename(u.fsPath)}` },
  { fsPath: path.join(root, 'media') }
);
const csp = "default-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; font-src 'self'";
demo = demo
  .replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, `<meta http-equiv="Content-Security-Policy" content="${csp}">`)
  .replace('<title>Skill Canvas</title>', '<title>Skill Canvas demo</title>\n  <meta name="robots" content="noindex">')
  .replace(/(<link href="runtime\/canvas\.css" rel="stylesheet">)/, `<link href="theme.css" rel="stylesheet">\n  $1\n  <link href="runtime/compact.css" rel="stylesheet">\n  <script src="runtime/export-bundle.js"></script>\n  <script src="model.js"></script>\n  <script src="host.js"></script>`);
if (!demo.includes('host.js')) {
  throw new Error('Could not inject the demo host into the webview markup.');
}
writeFileSync(path.join(out, 'demo', 'index.html'), demo);

// 4. Printouts on the landing page: real files generated from the same example.
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const editions = { claude: buildExport(model, 'loop-example', 'claude'), copilot: buildExport(model, 'loop-example', 'copilot') };
let index = readFileSync(path.join(out, 'index.html'), 'utf8');
index = index.replace(/\{\{file:(claude|copilot):([^}]+)\}\}/g, (_, target, file) => {
  const found = editions[target].files.find((f) => f.path === file);
  if (!found) {
    throw new Error(`No ${target} file ${file} in the example export.`);
  }
  return escape(found.content.trimEnd());
});
writeFileSync(path.join(out, 'index.html'), index);

console.log(`Built ${path.relative(root, out)}/ (demo from the extension's own webview and export code).`);
