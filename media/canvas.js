(function () {
  'use strict';
  const vscode = acquireVsCodeApi();

  // Forward webview errors to the "Skill Canvas" output channel.
  window.addEventListener('error', (e) => {
    vscode.postMessage({ type: 'error', message: `${e.message} (${e.filename}:${e.lineno})` });
  });

  const NS = 'http://www.w3.org/2000/svg';
  const W = 172;
  const H = 60;
  const SNAP = 8;

  // ---- Block kinds ----
  // `in`: has an input. `outs`: output ports (labels shown on branching blocks).
  // `uses`: can link to skills/tools it may use. `usable`: can be linked from an agent.
  const KINDS = {
    input: { label: 'Input', group: 'ends', desc: 'What the workflow starts with', in: false, outs: [{ id: 'out' }] },
    output: { label: 'Output', group: 'ends', desc: 'What the workflow delivers', in: true, outs: [] },
    agent: { label: 'Agent', group: 'work', desc: 'An AI assistant with its own instructions', in: true, outs: [{ id: 'out' }], uses: true },
    skill: { label: 'Skill', group: 'work', desc: 'Reusable instructions, like a playbook', in: true, outs: [{ id: 'out' }], usable: true },
    tool: { label: 'Tool', group: 'work', desc: 'A specific tool, like the terminal', in: true, outs: [{ id: 'out' }], usable: true },
    if: { label: 'If', group: 'logic', desc: 'Take one of two paths', in: true, outs: [{ id: 'true', label: 'yes' }, { id: 'false', label: 'no' }] },
    loop: { label: 'Loop', group: 'logic', desc: 'Repeat steps a set number of times', in: true, outs: [{ id: 'body', label: 'repeat' }, { id: 'done', label: 'done' }] },
  };
  const GROUPS = [['ends', 'Start and finish'], ['work', 'Work'], ['logic', 'Decide and repeat']];
  const NEXT_LABELS = { if: { true: 'If yes', false: 'If no' }, loop: { body: 'Each round', done: 'When done' } };

  const CLAUDE_TOOLS = [
    ['Read', 'Read files'], ['Grep', 'Search in files'], ['Glob', 'Find files'], ['Edit', 'Edit files'],
    ['Write', 'Create files'], ['Bash', 'Run terminal commands'], ['WebFetch', 'Open web pages'], ['WebSearch', 'Search the web'],
  ];
  const CLAUDE_MODELS = [['inherit', 'Same as the chat'], ['sonnet', 'Sonnet'], ['opus', 'Opus'], ['haiku', 'Haiku'], ['fable', 'Fable']];
  const isMac = /Mac/.test(navigator.platform);
  const UNDO = isMac ? '⌘Z' : 'Ctrl+Z';

  // ---- State ----
  let model = { version: 1, nodes: [], edges: [] };
  let sel = null; // { type: 'node' | 'edge', id }
  let gesture = null; // pan | drag | link
  let spaceDown = false;
  let analysis = null;
  const saved = vscode.getState() || {};
  let view = saved.view || { x: 40, y: 40, k: 1 };
  let needsFit = !saved.view;
  const ui = { props: saved.props !== false, preview: saved.preview === 'edit' ? 'edit' : 'preview', advanced: saved.advanced || {} };
  const persist = () => vscode.setState({ view, props: ui.props, preview: ui.preview, advanced: ui.advanced });

  const $ = (id) => document.getElementById(id);
  const svg = $('canvas');
  const viewport = $('viewport');
  const nodesG = $('nodes');
  const edgesG = $('edges');
  const props = $('props');

  // ---- Helpers ----
  const uid = () => Math.random().toString(36).slice(2, 9);
  const byId = (id) => model.nodes.find((n) => n.id === id);
  const kindOf = (n) => KINDS[n.kind] || KINDS.agent;
  const target = () => model.target || 'claude';
  const isUses = (e) => e.kind === 'uses';
  const nextEdges = () => model.edges.filter((e) => !isUses(e));
  const portOf = (n, port) => port || (kindOf(n).outs[0] || {}).id;
  const selNode = () => (sel && sel.type === 'node' ? byId(sel.id) : null);
  const nameOf = (id) => (byId(id) || {}).name || 'block';
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const snap = (v) => Math.round(v / SNAP) * SNAP;
  const list = (s) => (s || '').split(',').map((t) => t.trim()).filter(Boolean);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function el(name, attrs, parent) {
    const e = document.createElementNS(NS, name);
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null) continue;
      if (k === 'text') e.textContent = v;
      else e.setAttribute(k, v);
    }
    if (parent) parent.appendChild(e);
    return e;
  }

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k in e && !k.includes('-') && k !== 'list') e[k] = v;
      else if (v !== false) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
    return e;
  }

  function icon(name, cls) {
    const s = document.createElementNS(NS, 'svg');
    s.setAttribute('class', cls || 'icon');
    s.setAttribute('aria-hidden', 'true');
    const u = document.createElementNS(NS, 'use');
    u.setAttribute('href', `#i-${name}`);
    s.appendChild(u);
    return s;
  }

  function say(text) {
    const a = $('announce');
    a.textContent = '';
    setTimeout(() => (a.textContent = text), 30);
  }

  let statusTimer;
  function setStatus(text, opts = {}) {
    const s = $('status');
    clearTimeout(statusTimer);
    s.textContent = text;
    s.classList.toggle('done', !!opts.done);
    if (opts.clearAfter) statusTimer = setTimeout(() => (s.textContent = ''), opts.clearAfter);
  }

  // ---- Saving and analysis ----
  let saveTimer = null;
  let analyzeTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = null;
    vscode.postMessage({ type: 'edit', model });
    if ($('status').classList.contains('done')) setStatus('');
    analyze();
  }
  // Typing saves after a pause, so undo isn't per keystroke.
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
    analyze();
  }
  function flush() {
    if (saveTimer) save();
  }
  function analyze() {
    clearTimeout(analyzeTimer);
    analyzeTimer = setTimeout(() => {
      vscode.postMessage({ type: 'analyze', model, nodeId: selNode() ? sel.id : null });
    }, 100);
  }
  window.addEventListener('blur', flush);
  document.addEventListener('visibilitychange', flush);

  // ---- Viewport: pan and zoom ----
  function stageRect() {
    return svg.getBoundingClientRect();
  }
  function toWorld(cx, cy) {
    const r = stageRect();
    return { x: (cx - r.left - view.x) / view.k, y: (cy - r.top - view.y) / view.k };
  }
  function applyView() {
    viewport.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`);
    $('grid').setAttribute('patternTransform', `translate(${view.x},${view.y}) scale(${view.k})`);
    $('zoom-level').textContent = `${Math.round(view.k * 100)}%`;
    persist();
  }
  function zoomAt(factor, cx, cy) {
    const r = stageRect();
    const k = clamp(view.k * factor, 0.3, 2);
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    view = { k, x: px - (px - view.x) * (k / view.k), y: py - (py - view.y) * (k / view.k) };
    applyView();
  }
  function bounds() {
    const xs = model.nodes.map((n) => n.x);
    const ys = model.nodes.map((n) => n.y);
    // Back connections swoop below the blocks; leave room for them.
    const swoop = nextEdges().some((e) => byId(e.to) && byId(e.from) && byId(e.to).x < byId(e.from).x + 40) ? H + 40 : 0;
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs) + W, y1: Math.max(...ys) + H + swoop };
  }
  function fit() {
    const r = stageRect();
    if (!model.nodes.length || !r.width) {
      view = { x: 40, y: 40, k: 1 };
      return applyView();
    }
    const b = bounds();
    const pad = 48;
    // Never shrink below a readable size; if it still doesn't fit, show where the flow starts.
    const k = clamp(Math.min((r.width - pad * 2) / (b.x1 - b.x0), (r.height - pad * 2) / (b.y1 - b.y0), 1), 0.6, 1);
    const w = (b.x1 - b.x0) * k;
    const hgt = (b.y1 - b.y0) * k;
    view = {
      k,
      x: (w > r.width - pad * 2 ? pad : (r.width - w) / 2) - b.x0 * k,
      y: (hgt > r.height - pad * 2 ? pad : (r.height - hgt) / 2) - b.y0 * k,
    };
    applyView();
  }
  // Pan just enough to bring a block into view.
  function reveal(id) {
    const n = byId(id);
    const r = stageRect();
    if (!n || !r.width) return;
    const pad = 32;
    const sx = n.x * view.k + view.x;
    const sy = n.y * view.k + view.y;
    if (sx < pad) view.x += pad - sx;
    else if (sx + W * view.k > r.width - pad) view.x -= sx + W * view.k - (r.width - pad);
    if (sy < pad) view.y += pad - sy;
    else if (sy + H * view.k > r.height - pad) view.y -= sy + H * view.k - (r.height - pad);
    applyView();
  }

  // ---- Canvas rendering ----
  const portY = (k, i) => (H * (i + 1)) / (k.outs.length + 1);
  const diamond = (x, y, r) => `M${x},${y - r} L${x + r},${y} L${x},${y + r} L${x - r},${y} Z`;
  const pathD = (p) => `M${p[0].x},${p[0].y} C${p[1].x},${p[1].y} ${p[2].x},${p[2].y} ${p[3].x},${p[3].y}`;
  function bez(p, t) {
    const u = 1 - t;
    const f = (a, b, c, d) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * d;
    return { x: f(p[0].x, p[1].x, p[2].x, p[3].x), y: f(p[0].y, p[1].y, p[2].y, p[3].y) };
  }
  function curve(a, b, uses) {
    if (uses) {
      const dy = Math.max(30, Math.abs(b.y - a.y) / 2);
      return [a, { x: a.x, y: a.y + dy }, { x: b.x, y: b.y - dy }, b];
    }
    if (b.x - a.x >= 40) {
      const dx = Math.max(40, (b.x - a.x) / 2);
      return [a, { x: a.x + dx, y: a.y }, { x: b.x - dx, y: b.y }, b];
    }
    // Backward connection (e.g. back into a loop): swoop below both blocks.
    const y = Math.max(a.y, b.y) + H + 40;
    return [a, { x: a.x + 120, y }, { x: b.x - 120, y }, b];
  }
  const outPoint = (n, port) => {
    const k = kindOf(n);
    const i = Math.max(0, k.outs.findIndex((o) => o.id === portOf(n, port)));
    return { x: n.x + W, y: n.y + portY(k, i) };
  };
  const inPoint = (n) => ({ x: n.x - 7, y: n.y + H / 2 }); // arrow tip stops at the port
  const usesFrom = (n) => ({ x: n.x + W / 2, y: n.y + H + 5 });
  const usesTo = (n) => ({ x: n.x + W / 2, y: n.y - 5 });

  function warningCounts() {
    const counts = {};
    for (const w of (analysis && analysis.warnings) || []) if (w.nodeId) counts[w.nodeId] = (counts[w.nodeId] || 0) + 1;
    return counts;
  }

  const truncCache = new Map();
  function fitText(t, text, max) {
    const key = `${text}|${max}`;
    if (truncCache.has(key)) return (t.textContent = truncCache.get(key));
    t.textContent = text;
    let s = text;
    while (s.length > 1 && t.getComputedTextLength() > max) {
      s = s.slice(0, -1);
      t.textContent = `${s.trimEnd()}…`;
    }
    truncCache.set(key, t.textContent);
  }

  function render() {
    const active = document.activeElement;
    const focusedId = active && active.closest && nodesG.contains(active) ? active.closest('.node').getAttribute('data-id') : null;
    edgesG.replaceChildren();
    nodesG.replaceChildren();
    for (const e of model.edges) drawEdge(e);
    if (gesture && gesture.type === 'link') drawDraft();
    const warn = warningCounts();
    // DOM order is the Tab order: left to right, then top to bottom.
    for (const n of [...model.nodes].sort((a, b) => a.x - b.x || a.y - b.y)) drawNode(n, warn[n.id] || 0);
    if (focusedId) {
      const g = nodesG.querySelector(`[data-id="${CSS.escape(focusedId)}"]`);
      if (g) g.focus({ preventScroll: true });
    }
    $('empty').hidden = model.nodes.length > 0;
    updateTopbar();
  }

  function nodeLabel(n, warnings) {
    const k = kindOf(n);
    const parts = [`${k.label} block: ${n.name}.`];
    const outs = nextEdges().filter((e) => e.from === n.id && byId(e.to));
    if (outs.length) {
      parts.push(outs.map((e) => {
        const o = k.outs.find((p) => p.id === portOf(n, e.fromPort));
        return `${o && o.label ? `If ${o.label}, ` : ''}leads to ${nameOf(e.to)}.`;
      }).join(' '));
    }
    if (warnings) parts.push(`${plural(warnings, 'thing', 'things')} to fix.`);
    return parts.join(' ');
  }

  function linkState(n) {
    if (!gesture || gesture.type !== 'link') return '';
    if (n.id === gesture.anchor) return '';
    if (!canLink(gesture, n)) return ' dim';
    return gesture.hover && gesture.hover.id === n.id ? ' drop-ok drop-hover' : ' drop-ok';
  }

  function drawNode(n, warnings) {
    const k = kindOf(n);
    const selected = sel && sel.type === 'node' && sel.id === n.id;
    const g = el('g', {
      class: `node k-${n.kind}${selected ? ' selected' : ''}${linkState(n)}`,
      transform: `translate(${n.x},${n.y})`,
      'data-id': n.id,
      tabindex: 0,
      role: 'button',
      'aria-label': nodeLabel(n, warnings),
    }, nodesG);
    el('rect', { class: 'ring', x: -4, y: -4, width: W + 8, height: H + 8, rx: 11 }, g);
    el('rect', { class: 'body', width: W, height: H, rx: 8 }, g);
    el('use', { href: `#i-${n.kind}`, x: 12, y: 11, width: 16, height: 16, class: 'glyph' }, g);
    el('text', { class: 'kind', x: 34, y: 23, text: k.label }, g);
    const name = el('text', { class: 'name', x: 12, y: 46 }, g);
    fitText(name, n.name || 'Untitled', W - 24 - (k.outs.length > 1 ? 44 : 0));
    el('title', { text: n.name }, g);
    if (k.usable) el('path', { class: 'anchor', d: diamond(W / 2, 0, 4) }, g);
    if (k.in) port(g, 'in', 0, H / 2);
    k.outs.forEach((o, i) => {
      const y = portY(k, i);
      if (o.label) el('text', { class: 'port-label', x: W - 12, y: y + 4, text: o.label }, g);
      port(g, 'out', W, y, o.id);
    });
    if (k.uses) port(g, 'uses', W / 2, H);
    if (warnings) {
      const b = el('g', { class: 'badge', transform: `translate(${W - 16},0)` }, g);
      el('circle', { r: 9 }, b);
      el('text', { y: 4, text: String(warnings) }, b);
    }
  }

  function port(g, type, x, y, id) {
    const active = gesture && gesture.type === 'link' && gesture.anchor === g.getAttribute('data-id') &&
      ((type === 'out' && gesture.mode === 'next' && gesture.port === id) || (type === 'in' && gesture.mode === 'reverse') || (type === 'uses' && gesture.mode === 'uses'));
    const p = el('g', { class: `port-wrap port-${type}${active ? ' active' : ''}`, 'data-port': type, 'data-port-id': id || null }, g);
    if (type === 'uses') el('path', { class: 'port', d: diamond(x, y, 5) }, p);
    else el('circle', { class: 'port', cx: x, cy: y, r: 5 }, p);
    el('circle', { class: 'port-hit', cx: x, cy: y, r: 11 }, p);
  }

  function edgeLabel(e) {
    if (isUses(e)) return 'uses';
    const a = byId(e.from);
    const k = kindOf(a);
    if (k.outs.length < 2) return '';
    const o = k.outs.find((p) => p.id === portOf(a, e.fromPort));
    return o ? o.label : '';
  }

  function drawEdge(e) {
    const a = byId(e.from);
    const b = byId(e.to);
    if (!a || !b) return;
    const uses = isUses(e);
    const p = uses ? curve(usesFrom(a), usesTo(b), true) : curve(outPoint(a, e.fromPort), inPoint(b));
    const selected = sel && sel.type === 'edge' && sel.id === e.id;
    const g = el('g', { class: `edge ${uses ? 'uses' : 'next'}${selected ? ' selected' : ''}`, 'data-edge': e.id }, edgesG);
    const d = pathD(p);
    el('path', { class: 'line', d }, g);
    el('path', { class: 'hit', d }, g);
    const text = edgeLabel(e);
    if (text) {
      const m = bez(p, 0.5);
      const lg = el('g', { class: 'edge-label', transform: `translate(${m.x},${m.y})` }, g);
      const r = el('rect', { y: -9, height: 18, rx: 9 }, lg);
      const t = el('text', { y: 4, text }, lg);
      const w = t.getComputedTextLength() + 14;
      r.setAttribute('x', -w / 2);
      r.setAttribute('width', w);
    }
  }

  function drawDraft() {
    const g = gesture;
    const n = byId(g.anchor);
    if (!n) return;
    let p;
    if (g.mode === 'next') p = curve(outPoint(n, g.port), g.pt);
    else if (g.mode === 'reverse') p = curve(g.pt, inPoint(n));
    else p = curve(usesFrom(n), g.pt, true);
    el('path', { class: 'line', d: pathD(p) }, el('g', { class: 'edge draft' }, edgesG));
  }

  // ---- Linking rules ----
  function canLink(g, n) {
    if (!n || n.id === g.anchor) return false;
    if (g.mode === 'next') return kindOf(n).in;
    if (g.mode === 'reverse') return kindOf(n).outs.length > 0;
    return kindOf(n).usable && !model.edges.some((e) => isUses(e) && e.from === g.anchor && e.to === n.id);
  }

  function targetAt(ev, g) {
    const under = document.elementFromPoint(ev.clientX, ev.clientY);
    const nodeEl = under && under.closest && under.closest('.node');
    if (!nodeEl) return null;
    const n = byId(nodeEl.getAttribute('data-id'));
    if (!canLink(g, n)) return null;
    const portEl = under.closest('[data-port="out"]');
    return { id: n.id, port: portEl ? portEl.getAttribute('data-port-id') : undefined };
  }

  function connect(g, t) {
    if (g.mode === 'uses') {
      addEdge({ id: uid(), kind: 'uses', from: g.anchor, to: t.id });
      say(`${nameOf(g.anchor)} can now use ${nameOf(t.id)}.`);
      return;
    }
    let from = g.anchor;
    let to = t.id;
    let fromPort = g.port;
    if (g.mode === 'reverse') {
      from = t.id;
      to = g.anchor;
      const src = byId(from);
      const free = kindOf(src).outs.find((o) => !nextEdges().some((e) => e.from === from && portOf(src, e.fromPort) === o.id));
      fromPort = t.port || (free || kindOf(src).outs[0]).id;
    }
    const src = byId(from);
    if (nextEdges().some((e) => e.from === from && portOf(src, e.fromPort) === fromPort && e.to === to)) return;
    addEdge({ id: uid(), from, fromPort, to });
    const o = kindOf(src).outs.find((p) => p.id === fromPort);
    say(`Connected ${nameOf(from)}${o && o.label ? ` (${o.label})` : ''} to ${nameOf(to)}.`);
  }

  function addEdge(e) {
    model.edges.push(e);
    render();
    renderPanel();
    save();
  }
  function removeEdge(id) {
    model.edges = model.edges.filter((e) => e.id !== id);
    if (sel && sel.type === 'edge' && sel.id === id) sel = null;
    render();
    renderPanel();
    save();
  }

  // ---- Selection ----
  function select(next, rerender = true) {
    const changed = JSON.stringify(next) !== JSON.stringify(sel);
    sel = next;
    if (changed) {
      renderPanel();
      analyze();
    }
    if (rerender) render();
  }
  function focusNode(id) {
    const g = nodesG.querySelector(`[data-id="${CSS.escape(id)}"]`);
    if (g) g.focus({ preventScroll: true });
  }
  function focusField(key) {
    if (!ui.props) toggleProps(true);
    const f = props.querySelector(`[data-field="${key}"]`);
    if (f) {
      f.focus();
      if (f.select) f.select();
    }
  }

  // ---- Blocks ----
  function freeSpot() {
    const r = stageRect();
    const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
    const x0 = snap(c.x - W / 2);
    const y0 = snap(c.y - H / 2);
    let x = x0;
    let y = y0;
    for (let i = 0; i < 64 && model.nodes.some((n) => Math.abs(n.x - x) < W + 16 && Math.abs(n.y - y) < H + 16); i++) {
      y += H + 24;
      if (i % 4 === 3) {
        y = y0;
        x += W + 48;
      }
    }
    return { x, y };
  }

  function addNode(kind, at) {
    const k = KINDS[kind];
    const count = model.nodes.filter((n) => n.kind === kind).length;
    const pos = at ? { x: snap(at.x), y: snap(at.y) } : freeSpot();
    const node = { id: uid(), kind, name: count ? `${k.label} ${count + 1}` : k.label, x: pos.x, y: pos.y };
    model.nodes.push(node);
    select({ type: 'node', id: node.id });
    reveal(node.id);
    say(`${k.label} block added and selected. Edit it in the details panel.`);
    save();
    return node;
  }

  function duplicate(n) {
    const copy = { ...n, id: uid(), name: `${n.name} copy`, x: n.x + 24, y: n.y + H + 24 };
    model.nodes.push(copy);
    select({ type: 'node', id: copy.id });
    reveal(copy.id);
    say(`${n.name} duplicated.`);
    save();
  }

  function removeSelection() {
    if (!sel) return;
    if (sel.type === 'edge') {
      model.edges = model.edges.filter((e) => e.id !== sel.id);
      setStatus(`Connection removed. Undo with ${UNDO}.`, { clearAfter: 6000 });
      say(`Connection removed. Undo with ${UNDO}.`);
    } else {
      const n = byId(sel.id);
      if (!n) return;
      model.nodes = model.nodes.filter((x) => x.id !== n.id);
      model.edges = model.edges.filter((e) => e.from !== n.id && e.to !== n.id);
      setStatus(`Removed "${n.name}". Undo with ${UNDO}.`, { clearAfter: 6000 });
      say(`${n.name} removed. Undo with ${UNDO}.`);
    }
    sel = null;
    render();
    renderPanel();
    save();
    svg.focus({ preventScroll: true });
  }

  function moveNode(n, dx, dy) {
    n.x = snap(n.x + dx);
    n.y = snap(n.y + dy);
    render();
    reveal(n.id);
    saveSoon();
  }

  // ---- Starters (empty canvas) ----
  const STARTERS = {
    agent: () => [
      { key: 'i', kind: 'input', name: 'Request', x: 0, y: 0 },
      { key: 'a', kind: 'agent', name: 'Assistant', x: 240, y: 0, focus: true },
      { key: 'o', kind: 'output', name: 'Answer', x: 480, y: 0 },
      ['i', 'a'], ['a', 'o'],
    ],
    skill: () => [
      { key: 'i', kind: 'input', name: 'Request', x: 0, y: 0 },
      { key: 'a', kind: 'agent', name: 'Assistant', x: 240, y: 0, focus: true },
      { key: 'o', kind: 'output', name: 'Answer', x: 480, y: 0 },
      { key: 's', kind: 'skill', name: 'Playbook', x: 240, y: 152 },
      ['i', 'a'], ['a', 'o'], ['a', 's', 'uses'],
    ],
    retry: () => [
      { key: 'i', kind: 'input', name: 'Task', x: 0, y: 48 },
      { key: 'l', kind: 'loop', name: 'Up to 3 tries', x: 216, y: 48, maxIterations: 3 },
      { key: 'a', kind: 'agent', name: 'Do the work', x: 432, y: 0, focus: true },
      { key: 'c', kind: 'if', name: 'Did it work?', x: 648, y: 0, condition: 'The result meets the goal' },
      { key: 'o', kind: 'output', name: 'Result', x: 864, y: 0 },
      { key: 'x', kind: 'output', name: 'Ask for help', x: 432, y: 160 },
      ['i', 'l'], ['l', 'a', 'body'], ['a', 'c'], ['c', 'o', 'true'], ['c', 'l', 'false'], ['l', 'x', 'done'],
    ],
  };
  function startWith(key) {
    const ids = {};
    let focus = null;
    for (const item of STARTERS[key]()) {
      if (Array.isArray(item)) {
        const [from, to, port] = item;
        model.edges.push(port === 'uses' ? { id: uid(), kind: 'uses', from: ids[from], to: ids[to] } : { id: uid(), from: ids[from], fromPort: port || 'out', to: ids[to] });
      } else {
        const { key: k, focus: f, ...node } = item;
        node.id = uid();
        ids[k] = node.id;
        model.nodes.push(node);
        if (f) focus = node.id;
      }
    }
    sel = focus ? { type: 'node', id: focus } : null;
    save();
    render();
    fit();
    renderPanel();
    say('Starter added. Fill in what each agent is for, then export.');
    requestAnimationFrame(() => focusField('description'));
  }
  for (const b of document.querySelectorAll('[data-starter]')) b.addEventListener('click', () => startWith(b.dataset.starter));

  // ---- Pointer gestures ----
  let lastDown = {};
  svg.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0 && ev.button !== 1) return;
    closeIssues();
    const pt = toWorld(ev.clientX, ev.clientY);
    const nodeEl = ev.target.closest('.node');
    const portEl = ev.target.closest('[data-port]');
    const edgeEl = ev.target.closest('[data-edge]');
    if (spaceDown || ev.button === 1 || (!nodeEl && !edgeEl)) {
      gesture = { type: 'pan', sx: ev.clientX, sy: ev.clientY, vx: view.x, vy: view.y, moved: false };
    } else if (nodeEl && portEl) {
      const id = nodeEl.getAttribute('data-id');
      const type = portEl.getAttribute('data-port');
      gesture = { type: 'link', mode: type === 'out' ? 'next' : type === 'in' ? 'reverse' : 'uses', anchor: id, port: portEl.getAttribute('data-port-id') || undefined, pt, sx: ev.clientX, sy: ev.clientY };
      select({ type: 'node', id }, false);
    } else if (nodeEl) {
      const n = byId(nodeEl.getAttribute('data-id'));
      // Double-click renames. Detected here because the canvas redraws between clicks.
      if (lastDown.id === n.id && ev.timeStamp - lastDown.t < 400) {
        lastDown = {};
        focusField('name');
        return;
      }
      lastDown = { id: n.id, t: ev.timeStamp };
      select({ type: 'node', id: n.id }, false);
      gesture = { type: 'drag', id: n.id, dx: pt.x - n.x, dy: pt.y - n.y, moved: false };
    } else {
      select({ type: 'edge', id: edgeEl.getAttribute('data-edge') });
      svg.focus({ preventScroll: true });
      return;
    }
    ev.preventDefault();
    svg.setPointerCapture(ev.pointerId);
    svg.classList.toggle('panning', gesture.type === 'pan');
    render();
    if (nodeEl) focusNode(nodeEl.getAttribute('data-id'));
    else svg.focus({ preventScroll: true });
  });

  svg.addEventListener('pointermove', (ev) => {
    if (!gesture) return;
    if (gesture.type === 'pan') {
      const dx = ev.clientX - gesture.sx;
      const dy = ev.clientY - gesture.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) gesture.moved = true;
      view.x = gesture.vx + dx;
      view.y = gesture.vy + dy;
      applyView();
    } else if (gesture.type === 'drag') {
      const pt = toWorld(ev.clientX, ev.clientY);
      const n = byId(gesture.id);
      const x = snap(pt.x - gesture.dx);
      const y = snap(pt.y - gesture.dy);
      if (n && (x !== n.x || y !== n.y)) {
        n.x = x;
        n.y = y;
        gesture.moved = true;
        render();
      }
    } else if (gesture.type === 'link') {
      gesture.pt = toWorld(ev.clientX, ev.clientY);
      gesture.hover = targetAt(ev, gesture);
      render();
    }
  });

  function endGesture(ev) {
    const g = gesture;
    gesture = null;
    svg.classList.remove('panning');
    if (!g) return;
    if (g.type === 'pan') {
      if (!g.moved && ev) select(null);
    } else if (g.type === 'drag') {
      if (g.moved) save();
    } else if (g.type === 'link') {
      const t = ev && targetAt(ev, g);
      if (t) connect(g, t);
      else if (ev && Math.abs(ev.clientX - g.sx) + Math.abs(ev.clientY - g.sy) > 12) {
        const hint = g.mode === 'uses' ? 'Drop on a Skill or Tool block to link it.' : 'Drop on a highlighted block to connect.';
        setStatus(`Not connected. ${hint}`, { clearAfter: 5000 });
      }
      render();
    }
  }
  svg.addEventListener('pointerup', endGesture);
  // Interrupted gestures (cancelled, capture lost, window switched) end cleanly.
  svg.addEventListener('pointercancel', () => endGesture(null));
  svg.addEventListener('lostpointercapture', () => gesture && endGesture(null));
  window.addEventListener('blur', () => {
    spaceDown = false;
    svg.classList.remove('pan-ready');
    if (gesture) endGesture(null);
  });

  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    if (ev.ctrlKey || ev.metaKey) {
      zoomAt(Math.exp(-ev.deltaY * 0.01), ev.clientX, ev.clientY);
    } else {
      view.x -= ev.deltaX;
      view.y -= ev.deltaY;
      applyView();
    }
  }, { passive: false });

  nodesG.addEventListener('focusin', (ev) => {
    const g = ev.target.closest('.node');
    if (g && !(sel && sel.type === 'node' && sel.id === g.getAttribute('data-id'))) {
      select({ type: 'node', id: g.getAttribute('data-id') });
      reveal(g.getAttribute('data-id'));
    }
  });

  // Palette drag and drop.
  svg.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  svg.addEventListener('drop', (e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('text/plain');
    if (KINDS[kind]) {
      const p = toWorld(e.clientX, e.clientY);
      addNode(kind, { x: p.x - W / 2, y: p.y - H / 2 });
    }
  });

  document.querySelector('.zoom').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const z = b.dataset.zoom;
    if (z === 'in') zoomAt(1.2);
    else if (z === 'out') zoomAt(1 / 1.2);
    else if (z === 'fit') fit();
    else {
      const r = stageRect();
      zoomAt(1 / view.k, r.left + r.width / 2, r.top + r.height / 2);
    }
  });

  // ---- Keyboard ----
  window.addEventListener('keydown', (ev) => {
    const inField = ev.target.closest && ev.target.closest('input, textarea, select');
    if (ev.key === 'Escape') {
      if (gesture) {
        gesture = null;
        svg.classList.remove('panning');
        render();
      } else if (!$('issues-list').hidden) {
        closeIssues();
        $('issues').focus();
      } else if (inField && selNode()) {
        focusNode(sel.id);
      } else if (sel) {
        select(null);
        svg.focus({ preventScroll: true });
      }
      return;
    }
    if (inField || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const onCanvas = svg.contains(ev.target) || ev.target === document.body;
    const n = selNode();
    if (ev.key === ' ' && onCanvas) {
      spaceDown = true;
      svg.classList.add('pan-ready');
      ev.preventDefault();
      return;
    }
    if (!onCanvas) return;
    const step = ev.shiftKey ? 40 : SNAP;
    const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (arrows[ev.key]) {
      ev.preventDefault();
      const [dx, dy] = arrows[ev.key];
      if (n) moveNode(n, dx * step, dy * step);
      else {
        view.x -= dx * 40;
        view.y -= dy * 40;
        applyView();
      }
    } else if ((ev.key === 'Delete' || ev.key === 'Backspace') && sel) {
      ev.preventDefault();
      removeSelection();
    } else if ((ev.key === 'F2' || ev.key === 'Enter') && n) {
      ev.preventDefault();
      focusField('name');
    } else if (ev.key === '+' || ev.key === '=') {
      zoomAt(1.2);
    } else if (ev.key === '-' || ev.key === '_') {
      zoomAt(1 / 1.2);
    } else if (ev.key === '0') {
      fit();
    }
  });
  window.addEventListener('keyup', (ev) => {
    if (ev.key === ' ') {
      spaceDown = false;
      svg.classList.remove('pan-ready');
    }
  });

  // ---- Palette ----
  function buildPalette() {
    const root = $('palette-items');
    for (const [gid, gname] of GROUPS) {
      root.append(h('h3', { text: gname }));
      for (const [kind, k] of Object.entries(KINDS)) {
        if (k.group !== gid) continue;
        const b = h('button', {
          type: 'button', class: `block k-${kind}`, draggable: true,
          title: `${k.label}: ${k.desc}. Click to add, or drag onto the canvas.`,
          onclick: () => addNode(kind),
          ondragstart: (e) => {
            e.dataTransfer.setData('text/plain', kind);
            e.dataTransfer.effectAllowed = 'copy';
          },
        }, icon(kind, 'glyph'), h('span', { class: 'title', text: k.label }), h('span', { class: 'desc', text: k.desc }));
        root.append(b);
      }
    }
  }

  // ---- Top bar ----
  const nameInput = $('wf-name');
  nameInput.addEventListener('input', () => {
    if (nameInput.value.trim()) model.name = nameInput.value;
    else delete model.name;
    saveSoon();
  });
  nameInput.addEventListener('blur', flush);
  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') nameInput.blur();
  });

  $('wf-command').addEventListener('click', () => {
    const cmd = analysis && analysis.command;
    if (!cmd) return;
    vscode.postMessage({ type: 'copy', text: cmd });
    setStatus(`Copied ${cmd}. Paste it into ${analysis.label} chat to run the workflow.`, { clearAfter: 5000 });
  });

  const targetGroup = $('target');
  function setTarget(t) {
    if (target() === t) return;
    model.target = t;
    updateTopbar();
    renderPanel();
    save();
    say(`Exporting for ${t === 'claude' ? 'Claude Code' : 'GitHub Copilot'}.`);
  }
  targetGroup.addEventListener('click', (e) => {
    const b = e.target.closest('[data-target]');
    if (b) setTarget(b.dataset.target);
  });
  targetGroup.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const t = target() === 'claude' ? 'copilot' : 'claude';
      setTarget(t);
      targetGroup.querySelector(`[data-target="${t}"]`).focus();
    }
  });

  const sizeName = () => (nameInput.size = Math.max(8, (nameInput.value || nameInput.placeholder).length + 1));
  nameInput.addEventListener('input', sizeName);

  function updateTopbar() {
    if (document.activeElement !== nameInput) nameInput.value = model.name || '';
    nameInput.placeholder = (analysis && analysis.fallbackName) || 'Workflow name';
    sizeName();
    const chip = $('wf-command');
    const cmd = analysis && analysis.command;
    chip.hidden = !cmd;
    if (cmd && chip.dataset.cmd !== cmd) {
      chip.dataset.cmd = cmd;
      chip.replaceChildren(h('span', { text: cmd }), icon('copy'));
      chip.title = `Copy ${cmd}`;
      chip.setAttribute('aria-label', `Copy the command ${cmd}`);
    }
    for (const b of targetGroup.querySelectorAll('[data-target]')) {
      const on = b.dataset.target === target();
      b.setAttribute('aria-checked', String(on));
      b.tabIndex = on ? 0 : -1;
    }
    const count = analysis ? analysis.warnings.length : 0;
    const issues = $('issues');
    const label = !model.nodes.length ? '' : count ? `${count} to fix` : 'Ready';
    if (issues.dataset.label !== label) {
      issues.dataset.label = label;
      issues.replaceChildren(...(label ? [icon(count ? 'warning' : 'check', `icon ${count ? 'warn' : 'ok'}`), h('span', { text: label })] : []));
    }
    issues.hidden = !label;
    issues.disabled = !count;
    issues.setAttribute('aria-label', count ? `${plural(count, 'thing', 'things')} to fix. Show the list.` : 'Ready to export');
    $('export').disabled = !model.nodes.length;
  }

  // Things to fix.
  $('issues').addEventListener('click', () => ($('issues-list').hidden ? openIssues() : closeIssues()));
  function openIssues() {
    if (!analysis || !analysis.warnings.length) return;
    const listEl = $('issues-list');
    listEl.replaceChildren(...analysis.warnings.map((w) =>
      h('button', { type: 'button', class: 'issue', onclick: () => { closeIssues(); goToWarning(w); } },
        icon('warning', 'icon warn'),
        h('span', { class: 'issue-text' }, h('strong', { text: w.nodeId ? nameOf(w.nodeId) : 'Workflow' }), h('span', { text: w.text })))));
    listEl.hidden = false;
    $('issues').setAttribute('aria-expanded', 'true');
    listEl.querySelector('button').focus();
  }
  function closeIssues() {
    $('issues-list').hidden = true;
    $('issues').setAttribute('aria-expanded', 'false');
  }
  document.addEventListener('pointerdown', (e) => {
    if (!$('issues-list').hidden && !e.target.closest('#issues-list, #issues')) closeIssues();
  });
  function goToWarning(w) {
    if (!w.nodeId) return focusField(w.field || 'description');
    select({ type: 'node', id: w.nodeId });
    reveal(w.nodeId);
    requestAnimationFrame(() => (w.field && props.querySelector(`[data-field="${w.field}"]`) ? focusField(w.field) : focusNode(w.nodeId)));
  }

  // Export.
  $('export').addEventListener('click', () => {
    flush();
    closeIssues();
    $('export').disabled = true;
    setStatus('Choose where to save the files…');
    vscode.postMessage({ type: 'export', model });
  });

  function toggleProps(open) {
    ui.props = open ?? !ui.props;
    persist();
    renderPanel();
  }
  $('toggle-props').addEventListener('click', () => toggleProps());

  // ---- Details panel ----
  // The panel is the form (`.panel-main`) plus the file preview below it.
  function renderPanel() {
    document.body.classList.toggle('props-hidden', !ui.props);
    $('toggle-props').setAttribute('aria-pressed', String(ui.props));
    if (!ui.props) return;
    props.replaceChildren(h('div', { class: 'panel-main' }), previewSection());
    refreshFields();
  }

  // Rebuilds only the form, leaving the preview (and any text being edited there) alone.
  function refreshFields() {
    const main = props.querySelector('.panel-main');
    if (!main) return renderPanel();
    const into = h('div', { class: 'panel-main' });
    const n = selNode();
    const e = sel && sel.type === 'edge' ? model.edges.find((x) => x.id === sel.id) : null;
    if (n) nodePanel(n, into);
    else if (e) edgePanel(e, into);
    else workflowPanel(into);
    main.replaceWith(into);
    showAnalysis();
  }

  function head(kind, title, sub) {
    return h('div', { class: `props-head k-${kind}` }, icon(kind === 'logic' ? 'workflow' : kind, 'glyph'), h('h2', { text: title }), sub && h('span', { class: 'props-sub', text: sub }));
  }

  function field(obj, spec) {
    const id = `f-${spec.key}`;
    let input;
    if (spec.type === 'textarea') {
      input = h('textarea', { id, rows: spec.rows || 3 });
    } else if (spec.type === 'select') {
      input = h('select', { id }, spec.options.map(([v, t]) => h('option', { value: v, text: t })));
    } else {
      input = h('input', { id, type: spec.type === 'number' ? 'number' : 'text', spellcheck: false, autocomplete: 'off' });
      if (spec.type === 'number') {
        input.min = '1';
        input.max = '50';
      }
    }
    input.dataset.field = spec.key;
    if (spec.placeholder) input.placeholder = spec.placeholder;
    input.value = obj[spec.key] ?? (spec.type === 'select' ? spec.options[0][0] : '');
    input.setAttribute('aria-describedby', [spec.hint && `${id}-hint`, `${id}-warn`].filter(Boolean).join(' '));
    input.addEventListener('input', () => {
      const v = input.value;
      if (spec.key === 'name' && obj !== model) obj.name = v; // blocks keep a name, even while it's being retyped
      else if (v.trim() === '') delete obj[spec.key];
      else obj[spec.key] = spec.type === 'number' ? clamp(Math.round(Number(v)) || 1, 1, 50) : v;
      if (spec.key === 'name' && obj !== model) {
        render();
        const title = props.querySelector('.props-head h2');
        if (title) title.textContent = v || kindOf(obj).label;
      }
      saveSoon();
    });
    input.addEventListener('blur', flush);
    let dl = null;
    if (spec.list) {
      dl = h('datalist', { id: `${id}-list` }, spec.list.map(([v, t]) => h('option', { value: v, label: t })));
      input.setAttribute('list', dl.id);
    }
    return h('div', { class: 'field' },
      h('label', { class: 'label', for: id, text: spec.label }),
      spec.suffix ? h('div', { class: 'with-suffix' }, input, h('span', { text: spec.suffix })) : input,
      dl,
      spec.hint && h('small', { class: 'hint', id: `${id}-hint`, text: spec.hint }),
      warnSlot(spec.key, `${id}-warn`));
  }

  const warnSlot = (key, id) => h('div', { class: 'field-warning', id: id || `w-${key}`, 'data-warn-for': key, hidden: true });

  function advanced(obj, key, specs) {
    const d = h('details', { class: 'advanced', open: !!ui.advanced[key] },
      h('summary', {}, icon('chevron'), 'Advanced'),
      specs.map((s) => field(obj, s)));
    d.addEventListener('toggle', () => {
      ui.advanced[key] = d.open;
      persist();
    });
    return d;
  }

  function radio(name, label, checked, disabled, onchange) {
    return h('label', {}, h('input', { type: 'radio', name, checked, disabled, onchange }), h('span', { text: label }));
  }

  function linkedTo(n, kind) {
    return model.edges.filter((e) => isUses(e) && e.from === n.id && byId(e.to) && byId(e.to).kind === kind);
  }

  function toolsSection(n) {
    const linked = linkedTo(n, 'tool').map((e) => byId(e.to));
    const restrict = n.toolsMode === 'only' || (n.toolsMode === undefined && !!(n.tools || '').trim()) || linked.length > 0;
    const setMode = (mode) => {
      n.toolsMode = mode;
      renderPanel();
      save();
    };
    const box = h('fieldset', { class: 'field' }, h('legend', { class: 'label', text: 'Can use' }),
      h('div', { class: 'radios' },
        radio(`tools-${n.id}`, 'All tools', !restrict, linked.length > 0, () => setMode('all')),
        radio(`tools-${n.id}`, 'Only the tools I choose', restrict, false, () => setMode('only'))));
    if (restrict) {
      if (target() === 'claude') {
        const known = new Set(CLAUDE_TOOLS.map(([id]) => id));
        const chosen = new Set(list(n.tools).filter((t) => known.has(t)));
        const other = h('input', { type: 'text', id: 'f-tools', spellcheck: false, placeholder: 'e.g. mcp__github__create_issue' });
        other.dataset.field = 'tools';
        other.value = list(n.tools).filter((t) => !known.has(t)).join(', ');
        const update = () => {
          const all = [...chosen, ...list(other.value)];
          if (all.length) n.tools = all.join(', ');
          else delete n.tools;
          saveSoon();
        };
        other.addEventListener('input', update);
        other.addEventListener('blur', flush);
        box.append(h('div', { class: 'checks' }, CLAUDE_TOOLS.map(([id, label]) =>
          h('label', {}, h('input', { type: 'checkbox', checked: chosen.has(id), onchange: (e) => { e.target.checked ? chosen.add(id) : chosen.delete(id); update(); } }), h('span', { text: label })))));
        box.append(h('label', { class: 'hint', for: 'f-tools', text: 'Other tools, comma-separated' }), other);
      } else {
        const input = h('input', { type: 'text', id: 'f-tools', spellcheck: false, placeholder: 'e.g. search/codebase, web/fetch' });
        input.dataset.field = 'tools';
        input.value = n.tools || '';
        input.setAttribute('aria-label', 'Copilot tool names, comma-separated');
        input.addEventListener('input', () => {
          if (input.value.trim()) n.tools = input.value;
          else delete n.tools;
          saveSoon();
        });
        input.addEventListener('blur', flush);
        box.append(input, h('small', { class: 'hint', text: 'Copilot tool names, comma-separated.' }));
      }
      if (linked.length) box.append(h('small', { class: 'hint', text: `Also allowed through links on the canvas: ${linked.map((t) => t.name).join(', ')}.` }));
    }
    box.append(warnSlot('tools'));
    return box;
  }

  function skillsSection(n) {
    const links = linkedTo(n, 'skill');
    const free = model.nodes.filter((x) => x.kind === 'skill' && !links.some((e) => e.to === x.id));
    const box = h('fieldset', { class: 'field' }, h('legend', { class: 'label', text: 'Skills it knows' }));
    if (links.length) {
      box.append(h('ul', { class: 'linked' }, links.map((e) => h('li', {},
        icon('skill', 'glyph k-skill'), h('span', { text: nameOf(e.to) }),
        h('button', { type: 'button', class: 'icon-button', title: 'Unlink', 'aria-label': `Unlink ${nameOf(e.to)}`, onclick: () => removeEdge(e.id) }, icon('close'))))));
    }
    if (free.length) {
      box.append(h('select', {
        'aria-label': 'Link a skill',
        onchange: (ev) => ev.target.value && addEdge({ id: uid(), kind: 'uses', from: n.id, to: ev.target.value }),
      }, h('option', { value: '', text: 'Link a skill…' }), free.map((s) => h('option', { value: s.id, text: s.name }))));
    }
    const how = target() === 'claude' ? 'Linked skills are loaded into the agent when it starts.' : "Linked skills are named in the agent's instructions.";
    box.append(h('small', { class: 'hint', text: links.length || free.length ? how : 'Add a Skill block, then link it here or drag from the handle under this agent.' }));
    return box;
  }

  function usedBySection(n) {
    const links = model.edges.filter((e) => isUses(e) && e.to === n.id && byId(e.from));
    const box = h('fieldset', { class: 'field' }, h('legend', { class: 'label', text: 'Used by' }));
    if (links.length) {
      box.append(h('ul', { class: 'linked' }, links.map((e) => h('li', {},
        icon('agent', 'glyph k-agent'), h('span', { text: nameOf(e.from) }),
        h('button', { type: 'button', class: 'icon-button', title: 'Unlink', 'aria-label': `Unlink from ${nameOf(e.from)}`, onclick: () => removeEdge(e.id) }, icon('close'))))));
    }
    const what = n.kind === 'tool' ? 'A linked tool is allowed for that agent instead of being a step.' : 'A linked skill is part of that agent instead of being a step.';
    box.append(h('small', { class: 'hint', text: links.length ? what : 'No agent uses it yet. Drag from the handle under an agent to this block to link them.' }));
    return box;
  }

  function nextSection(n) {
    const k = kindOf(n);
    const box = h('fieldset', { class: 'field' }, h('legend', { class: 'label', text: k.outs.length > 1 ? 'Where it goes' : 'Next step' }));
    const options = model.nodes.filter((x) => x.id !== n.id && kindOf(x).in).sort((a, b) => a.x - b.x);
    for (const o of k.outs) {
      const label = (NEXT_LABELS[n.kind] || {})[o.id] || 'Then';
      const edges = nextEdges().filter((e) => e.from === n.id && portOf(n, e.fromPort) === o.id);
      (edges.length ? edges : [null]).forEach((edge, i) => {
        const aria = `${label}, next step`;
        const pick = h('select', {
          'aria-label': aria,
          onchange: (ev) => setNext(n, o.id, edge, ev.target.value, aria),
        }, h('option', { value: '', text: 'Nothing, stop here' }), options.map((c) => h('option', { value: c.id, text: c.name, selected: !!edge && edge.to === c.id })));
        box.append(h('div', { class: 'next-row' },
          h('span', { class: 'next-label', text: i === 0 ? label : '' }),
          pick,
          edge ? h('button', { type: 'button', class: 'icon-button', title: 'Remove this connection', 'aria-label': `Remove the connection to ${nameOf(edge.to)}`, onclick: () => setNext(n, o.id, edge, '', aria) }, icon('close')) : h('span')));
      });
    }
    return box;
  }

  function setNext(n, port, edge, toId, aria) {
    if (edge && !toId) model.edges = model.edges.filter((e) => e !== edge);
    else if (edge) edge.to = toId;
    else if (toId) model.edges.push({ id: uid(), from: n.id, fromPort: port, to: toId });
    render();
    renderPanel();
    save();
    const again = props.querySelector(`select[aria-label="${CSS.escape(aria)}"]`);
    if (again) again.focus();
    say(toId ? `${aria.split(',')[0]}: ${nameOf(toId)}.` : 'Connection removed.');
  }

  function fieldsFor(n) {
    const claude = target() === 'claude';
    const NAME = { key: 'name', label: 'Name' };
    switch (n.kind) {
      case 'agent':
        return [
          NAME,
          { key: 'description', label: "What it's for", type: 'textarea', rows: 2, hint: 'The AI reads this to decide when to hand work to this agent.', placeholder: 'e.g. Fixes reported bugs and checks that the tests pass' },
          { key: 'prompt', label: 'Instructions', type: 'textarea', rows: 7, hint: 'How the agent should work, in your own words.', placeholder: 'e.g. Reproduce the bug first. Keep changes small.' },
          () => toolsSection(n),
          () => skillsSection(n),
          () => advanced(n, 'agent', claude
            ? [{ key: 'model', label: 'Model', type: 'select', options: CLAUDE_MODELS },
              { key: 'skills', label: 'Other skills to load', hint: 'Names of skills installed elsewhere, comma-separated.' }]
            : [{ key: 'model', label: 'Model', hint: 'A Copilot model name, as shown in its model picker. Leave empty to use the current one.' }]),
        ];
      case 'skill':
        return [
          NAME,
          { key: 'description', label: "What it's for", type: 'textarea', rows: 2, hint: 'The AI reads this to decide when to use this skill.', placeholder: 'e.g. Writes release notes from a list of changes' },
          { key: 'prompt', label: 'Instructions', type: 'textarea', rows: 7, hint: 'The steps or rules to follow whenever this skill is used.' },
          () => usedBySection(n),
          () => advanced(n, 'skill', [
            { key: 'argumentHint', label: 'Input hint', hint: 'Shown when someone runs it as /name, e.g. [issue number].' },
            ...(claude ? [{ key: 'tools', label: 'Tools it may use without asking', hint: 'Comma-separated, e.g. Read, Bash(git:*).' }] : []),
          ]),
        ];
      case 'tool':
        return [
          { key: 'name', label: 'Tool', list: claude ? CLAUDE_TOOLS : null, hint: claude ? 'Pick from the list, or type the name of an MCP tool.' : 'The Copilot tool name, e.g. search/codebase.' },
          { key: 'prompt', label: 'How to use it', type: 'textarea', rows: 3 },
          () => usedBySection(n),
        ];
      case 'input':
        return [NAME, { key: 'prompt', label: 'What the user provides', type: 'textarea', rows: 3, placeholder: 'e.g. A bug report with steps to reproduce' }];
      case 'output':
        return [NAME, { key: 'prompt', label: 'What to deliver', type: 'textarea', rows: 3, placeholder: 'e.g. A pull request with a short summary' }];
      case 'if':
        return [NAME, { key: 'condition', label: 'Question to check', type: 'textarea', rows: 2, hint: 'Answered yes or no while the workflow runs.', placeholder: 'e.g. Do all the tests pass?' }];
      case 'loop':
        return [
          NAME,
          { key: 'maxIterations', label: 'Repeat at most', type: 'number', suffix: 'times' },
          { key: 'condition', label: 'Keep going while', type: 'textarea', rows: 2, hint: 'Optional. The loop always stops at the limit above.', placeholder: 'e.g. the tests still fail' },
        ];
      default:
        return [NAME];
    }
  }

  function nodePanel(n, into) {
    const k = kindOf(n);
    into.append(head(n.kind, n.name || k.label, k.label));
    const body = h('div', { class: 'props-body' }, h('div', { class: 'general-warnings', hidden: true }));
    for (const spec of fieldsFor(n)) body.append(typeof spec === 'function' ? spec() : field(n, spec));
    if (k.outs.length) body.append(nextSection(n));
    into.append(body);
    into.append(h('div', { class: 'props-foot' },
      h('button', { type: 'button', class: 'secondary', onclick: () => duplicate(n) }, icon('copy'), 'Duplicate'),
      h('button', { type: 'button', class: 'secondary', onclick: removeSelection }, icon('trash'), 'Delete')));
  }

  function edgePanel(e, into) {
    const a = byId(e.from);
    const b = byId(e.to);
    const uses = isUses(e);
    const label = edgeLabel(e);
    into.append(head('logic', uses ? 'Link' : 'Connection'));
    const text = uses ? `${a.name} can use ${b.name}.` : `${label ? `If ${label}, ` : ''}${a.name} leads to ${b.name}.`;
    into.append(h('div', { class: 'props-body' },
      h('p', { text }),
      h('small', { class: 'hint', text: 'Press Delete to remove it.' })));
    into.append(h('div', { class: 'props-foot' }, h('button', { type: 'button', class: 'secondary', onclick: removeSelection }, icon('trash'), uses ? 'Remove link' : 'Remove connection')));
  }

  function workflowPanel(into) {
    const cmd = analysis && analysis.command;
    into.append(head('logic', 'Workflow'));
    into.append(h('div', { class: 'props-body' },
      field(model, {
        key: 'description', label: 'When to run it', type: 'textarea', rows: 3,
        hint: cmd ? `The AI reads this to decide when to run ${cmd}. You can also type ${cmd} in chat yourself.` : 'Becomes a /command once two or more steps are connected.',
      }),
      advanced(model, 'workflow', [{ key: 'argumentHint', label: 'Input hint', hint: 'Shown when someone types the command, e.g. [bug description].' }]),
      h('div', {}, h('h3', { text: 'Files it will create' }), h('ul', { class: 'files' }))));
  }

  // ---- File preview: rendered Markdown, or the file itself to edit ----
  const currentPreview = () => (analysis && analysis.nodeId === (selNode() ? sel.id : null) ? analysis.preview : null);

  function previewSection() {
    const tabs = h('div', { class: 'segmented small', role: 'tablist', 'aria-label': 'File view' });
    const box = h('section', { class: 'preview', 'aria-label': 'Generated file' },
      h('div', { class: 'preview-head' }, h('h3', { text: 'Generated file' }), tabs),
      h('p', { class: 'path' }),
      h('div', { class: 'md', tabindex: 0, role: 'tabpanel', 'aria-label': 'Preview' }),
      h('div', { class: 'md-editor', role: 'tabpanel' },
        h('textarea', { class: 'md-source', spellcheck: false, 'aria-label': 'File contents' }),
        h('small', { class: 'hint md-note' })));
    const source = box.querySelector('.md-source');
    let readTimer;
    source.addEventListener('input', () => {
      clearTimeout(readTimer);
      readTimer = setTimeout(() => {
        const n = selNode();
        if (n) vscode.postMessage({ type: 'readback', model, nodeId: n.id, text: source.value });
      }, 350);
    });
    // Once editing stops, show the file as it will really be written.
    source.addEventListener('blur', () => setTimeout(() => document.activeElement !== source && fillPreview(), 400));
    return box;
  }

  function previewTabs(box, p) {
    const tabs = box.querySelector('[role="tablist"]');
    const second = p && p.editable ? 'Edit file' : 'File';
    const want = [['preview', 'Preview'], ['edit', second]];
    if (tabs.dataset.second === second) {
      for (const b of tabs.children) {
        b.setAttribute('aria-selected', String(b.dataset.view === ui.preview));
        b.tabIndex = b.dataset.view === ui.preview ? 0 : -1;
      }
      return;
    }
    tabs.dataset.second = second;
    tabs.replaceChildren(...want.map(([v, t]) => h('button', {
      type: 'button', role: 'tab', 'data-view': v, 'aria-selected': String(ui.preview === v), tabindex: ui.preview === v ? 0 : -1,
      onclick: () => {
        ui.preview = v;
        persist();
        fillPreview();
      },
      onkeydown: (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          ui.preview = ui.preview === 'preview' ? 'edit' : 'preview';
          persist();
          fillPreview();
          tabs.querySelector(`[data-view="${ui.preview}"]`).focus();
        }
      },
    }, t)));
  }

  function fillPreview() {
    const box = props.querySelector('.preview');
    if (!box) return;
    const p = currentPreview();
    const pathEl = box.querySelector('.path');
    const md = box.querySelector('.md');
    const editor = box.querySelector('.md-editor');
    const source = box.querySelector('.md-source');
    previewTabs(box, p);
    if (!p) {
      md.hidden = true;
      editor.hidden = true;
      pathEl.textContent = !model.nodes.length
        ? 'Add blocks to see the files they become.'
        : selNode() ? 'Connect this block to another step to see it in the workflow.' : 'Nothing to preview yet.';
      return;
    }
    pathEl.textContent = `Saved as ${p.path}`;
    const editing = ui.preview === 'edit';
    md.hidden = editing;
    editor.hidden = !editing;
    if (editing) {
      // Never overwrite what someone is typing.
      if (document.activeElement !== source) source.value = p.content;
      source.readOnly = !p.editable;
      box.querySelector('.md-note').textContent = p.editable
        ? 'Edit the file directly. Your changes update the fields above.'
        : 'Built from the blocks and connections. Change those to change this file.';
      return;
    }
    md.replaceChildren(...renderMarkdown(p.content, p.line));
    const hl = md.querySelector('.hl');
    const key = selNode() ? sel.id : '';
    if (hl && box.dataset.scrolledFor !== key) {
      box.dataset.scrolledFor = key;
      md.scrollTop = hl.offsetTop - md.clientHeight / 3;
    }
  }

  // A small Markdown renderer for generated files: the header becomes a property
  // table; headings, lists, paragraphs, code blocks and inline styles are rendered.
  function renderMarkdown(content, hlLine) {
    const out = [];
    const lines = content.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    let i = 0;
    if (lines[0] === '---') {
      const end = lines.indexOf('---', 1);
      if (end > 0) {
        const dl = h('dl', { class: 'md-props' });
        let dd = null;
        for (const line of lines.slice(1, end)) {
          const item = /^\s+-\s*(.*)$/.exec(line);
          const kv = /^([\w-]+):\s*(.*)$/.exec(line);
          if (item && dd) dd.append(dd.textContent ? ', ' : '', unquote(item[1]));
          else if (kv) {
            dd = h('dd', { text: unquote(kv[2]) });
            dl.append(h('dt', { text: kv[1] }), dd);
          }
        }
        out.push(dl);
        i = end + 1;
      }
    }
    let para = null;
    let listEl = null;
    for (; i < lines.length; i++) {
      const line = lines[i];
      const mark = (e) => {
        if (i === hlLine) e.classList.add('hl');
        return e;
      };
      let m;
      if (/^```/.test(line)) {
        const code = [];
        for (i++; i < lines.length && !/^```/.test(lines[i]); i++) code.push(lines[i]);
        out.push(h('pre', { class: 'md-code', text: code.join('\n') }));
        para = listEl = null;
      } else if (!line.trim()) {
        para = listEl = null;
      } else if ((m = /^(#{1,6})\s+(.*)$/.exec(line))) {
        out.push(mark(h(`h${Math.min(6, m[1].length + 2)}`, { class: 'md-h' }, inline(m[2]))));
        para = listEl = null;
      } else if ((m = /^\s*(?:(\d+)[.)]|[-*+])\s+(.*)$/.exec(line))) {
        const tag = m[1] ? 'ol' : 'ul';
        if (!listEl || listEl.tagName.toLowerCase() !== tag) {
          listEl = h(tag, m[1] ? { start: Number(m[1]) } : {});
          out.push(listEl);
        }
        listEl.append(mark(h('li', {}, inline(m[2]))));
        para = null;
      } else if (listEl && /^\s{2,}\S/.test(line)) {
        listEl.lastChild.append(' ', ...inline(line.trim()));
      } else {
        listEl = null;
        if (para) para.append(' ');
        else out.push((para = h('p')));
        para.append(...inline(line));
        mark(para);
      }
    }
    return out;
  }

  function unquote(v) {
    const s = v.trim();
    if (s.startsWith('"') && s.endsWith('"')) {
      try {
        return JSON.parse(s);
      } catch {
        return s.slice(1, -1);
      }
    }
    return s;
  }

  // Inline Markdown: code, bold, italic and links (shown as text).
  function inline(text) {
    return text.split(/(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|\[[^\]]+\]\([^)]+\))/).filter(Boolean).map((part) => {
      if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) return h('code', { text: part.slice(1, -1) });
      if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) return h('strong', { text: part.slice(2, -2) });
      if (part.length > 2 && part.startsWith('*') && part.endsWith('*')) return h('em', { text: part.slice(1, -1) });
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
      if (link) return h('span', { class: 'md-link', title: link[2], text: link[1] });
      return part;
    });
  }

  function showAnalysis() {
    if (!analysis) return;
    const nodeId = selNode() ? sel.id : null;
    for (const slot of props.querySelectorAll('[data-warn-for]')) {
      slot.hidden = true;
      slot.replaceChildren();
    }
    const general = [];
    if (analysis.nodeId === nodeId) {
      for (const w of analysis.warnings.filter((x) => (nodeId ? x.nodeId === nodeId : !x.nodeId))) {
        const slot = w.field && props.querySelector(`[data-warn-for="${w.field}"]`);
        if (slot) {
          slot.hidden = false;
          slot.append(icon('warning'), h('span', { text: w.text }));
        } else general.push(w);
      }
    }
    const box = props.querySelector('.general-warnings');
    if (box) {
      box.replaceChildren(...general.map((w) => h('p', { class: 'field-warning' }, icon('warning'), h('span', { text: w.text }))));
      box.hidden = !general.length;
    }
    const files = props.querySelector('.files');
    if (files) {
      files.replaceChildren(...analysis.files.map((f) => h('li', {}, h('button', {
        type: 'button', disabled: !f.nodeId,
        onclick: () => {
          select({ type: 'node', id: f.nodeId });
          reveal(f.nodeId);
        },
      }, icon(f.kind === 'workflow' ? 'workflow' : f.kind, `glyph k-${f.kind === 'workflow' ? 'logic' : f.kind}`), h('span', { text: f.path })))));
      if (!analysis.files.length) files.append(h('li', { class: 'hint', text: 'None yet. Add an Agent or Skill block.' }));
    }
    fillPreview();
  }

  // ---- Messages from the extension ----
  let lastCommand = null;
  window.addEventListener('message', (evt) => {
    const msg = evt.data;
    if (msg.type === 'load') {
      model = msg.model;
      if (sel && ((sel.type === 'node' && !byId(sel.id)) || (sel.type === 'edge' && !model.edges.some((e) => e.id === sel.id)))) sel = null;
      render();
      if (needsFit) {
        needsFit = false;
        requestAnimationFrame(fit);
      }
      // Don't rebuild the form under the cursor while someone is typing in it.
      if (!props.contains(document.activeElement)) renderPanel();
      analyze();
    } else if (msg.type === 'analysis') {
      analysis = msg;
      render();
      const typing = props.contains(document.activeElement);
      if (!sel && msg.command !== lastCommand && !typing) renderPanel();
      else showAnalysis();
      lastCommand = msg.command;
      if (msg.nodeId !== (selNode() ? sel.id : null)) analyze();
    } else if (msg.type === 'patch') {
      // Fields read back from an edited file.
      const n = selNode();
      if (!msg.patch || !n || n.id !== msg.nodeId) return;
      for (const [k, v] of Object.entries(msg.patch)) {
        if (v === undefined || v === null || v === '') delete n[k];
        else n[k] = v;
      }
      render();
      refreshFields();
      saveSoon();
    } else if (msg.type === 'exported') {
      $('export').disabled = !model.nodes.length;
      const s = msg.summary;
      if (!s) return setStatus('');
      const next = s.command ? `Run ${s.command} in ${s.label} chat.` : `${s.label} can use them now.`;
      setStatus(`Saved ${plural(s.written, 'file', 'files')}${s.removed ? `, removed ${s.removed}` : ''}. ${next}`, { done: true });
      const chip = $('wf-command');
      chip.classList.remove('ready');
      void chip.offsetWidth; // restart the highlight
      chip.classList.add('ready');
    }
  });

  buildPalette();
  applyView();
  renderPanel();
  updateTopbar();
  vscode.postMessage({ type: 'ready' });
})();
