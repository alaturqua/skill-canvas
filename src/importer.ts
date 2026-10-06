import { editableKeys, extraOf, HELPERS_LINE, parseFile, settingsFrom, slug, stripMoreDetail } from './export';
import { CanvasEdge, CanvasNode, Scope, SkillFile, Target, TestScenario } from './model';

/** An agent or skill file found on disk. */
export interface FoundFile {
  /** Path relative to the target's root folder, e.g. `agents/reviewer.md` or `skills/notes/SKILL.md`. */
  path: string;
  text: string;
  kind: 'agent' | 'skill';
  target: Target;
  scope: Scope;
  /** Skills: the other files in the skill's folder, relative to it. `text` for Markdown and evals/evals.json. */
  extras?: { path: string; text?: string }[];
}

export interface ImportResult {
  /** New blocks, positioned by the canvas. */
  nodes: CanvasNode[];
  /** "Uses" links from imported agents to the skills they preload. */
  edges: CanvasEdge[];
  /** Files an export of these blocks would write back to exactly, so the canvas may update them. */
  owned: { target: Target; scope: Scope; path: string }[];
}

/** Marks workflow skills that Skill Canvas itself generated. */
export const WORKFLOW_MARKER = 'Follow these steps. "Go to step N" means continue from that step.';

/** `code-reviewer` → `Code reviewer`, so names read naturally but export back to the same file name. */
export function humanize(name: string): string {
  const s = name.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : name;
}

const list = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v : (v ?? '').split(',')).map((t) => t.trim()).filter(Boolean);
const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
/** Leaves out unset fields, so blocks only carry what was in the file. */
const defined = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

/** The name a file is known by: a skill's folder, or an agent's `name` (falling back to its file name). */
export function fileName(f: Pick<FoundFile, 'path' | 'text' | 'kind'>): string {
  const parts = f.path.split('/');
  if (f.kind === 'skill') {
    return parts[parts.length - 2] ?? 'skill';
  }
  const fromFile = parts[parts.length - 1].replace(/\.agent\.md$|\.md$/i, '');
  return str(parseFile(f.text).fields.name) ?? fromFile;
}

/**
 * Test scenarios in the guide's format, when the canvas can edit every part of them;
 * otherwise undefined, and the file is kept as it is.
 */
function scenariosFrom(text: string, skill: string): TestScenario[] | undefined {
  let items: unknown;
  try {
    items = JSON.parse(text);
  } catch {
    return undefined;
  }
  const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
  const fits = (e: any) =>
    e && typeof e === 'object' && typeof e.query === 'string' &&
    Object.keys(e).every((k) => ['skills', 'query', 'files', 'expected_behavior'].includes(k)) &&
    (e.skills === undefined || (strings(e.skills) && e.skills.length === 1 && e.skills[0] === skill)) &&
    (e.files === undefined || strings(e.files)) && (e.expected_behavior === undefined || strings(e.expected_behavior));
  if (!Array.isArray(items) || !items.length || !items.every(fits)) {
    return undefined;
  }
  return items.map((e: any) => defined({
    query: e.query,
    expected: (e.expected_behavior ?? []).join('\n') || undefined,
    files: (e.files ?? []).join(', ') || undefined,
  }) as TestScenario);
}

/** Where an export of a block with this name would write, relative to the target's root. */
function exportPath(kind: 'agent' | 'skill', name: string, target: Target) {
  const s = slug(name);
  if (kind === 'skill') {
    return `skills/${s}/SKILL.md`;
  }
  return target === 'claude' ? `agents/${s}.md` : `agents/${s}.agent.md`;
}

/**
 * Turns agent and skill files into blocks. Skills are read first so agents that
 * preload them get "uses" links; skills that aren't on the canvas stay as names.
 */
export function importFiles(files: FoundFile[], existing: CanvasNode[], newId: () => string): ImportResult {
  const nodes: CanvasNode[] = [];
  const edges: CanvasEdge[] = [];
  const owned: ImportResult['owned'] = [];
  const skillIds = new Map<string, string>();
  for (const n of existing) {
    if (n.kind === 'skill') {
      skillIds.set(slug(n.name), n.id);
    }
  }

  const skills = files.filter((f) => f.kind === 'skill');
  const agents = files.filter((f) => f.kind === 'agent');
  for (const f of skills) {
    const { fields, body: text, raw } = parseFile(f.text);
    const name = fileName(f);
    const editable = editableKeys('skill', f.target, fields);
    const references: SkillFile[] = [];
    const otherFiles: string[] = [];
    let evals: TestScenario[] | undefined;
    for (const x of f.extras ?? []) {
      const scenarios = x.path === 'evals/evals.json' && x.text !== undefined ? scenariosFrom(x.text, name) : undefined;
      if (scenarios) {
        evals = scenarios;
      } else if (/\.md$/i.test(x.path) && x.text !== undefined) {
        references.push({ path: x.path, content: x.text.replace(/\s+$/, '') });
      } else {
        otherFiles.push(x.path);
      }
    }
    // The list of extra files at the end, as the canvas writes it, becomes their "when" texts.
    const stripped = references.length ? stripMoreDetail(text, references.map((r) => r.path)) : undefined;
    const body = stripped ? stripped.body : text;
    for (const r of references) {
      if (stripped?.when[r.path]) {
        r.when = stripped.when[r.path];
      }
    }
    const node: CanvasNode = {
      ...(f.target === 'claude' ? defined(settingsFrom('skill', fields, editable)) : {}),
      id: newId(),
      kind: 'skill',
      name: humanize(name),
      x: 0,
      y: 0,
      description: str(fields.description),
      prompt: body || undefined,
      argumentHint: str(fields['argument-hint']),
      tools: f.target === 'claude' ? list(fields['allowed-tools']).join(', ') || undefined : undefined,
      extra: extraOf(raw, editable),
      references: references.length ? references.map((r) => ({ path: r.path, when: r.when, content: r.content })) : undefined,
      evals,
      otherFiles: otherFiles.length ? otherFiles : undefined,
    };
    nodes.push(node);
    skillIds.set(slug(node.name), node.id);
    if (exportPath('skill', node.name, f.target) === f.path) {
      const folder = f.path.slice(0, -'SKILL.md'.length);
      const written = [...references.map((r) => r.path), ...(evals ? ['evals/evals.json'] : [])];
      owned.push(...[f.path, ...written.map((p) => folder + p)].map((path) => ({ target: f.target, scope: f.scope, path })));
    }
  }

  const agentIds = new Map(existing.filter((n) => n.kind === 'agent').map((n) => [slug(n.name), n.id]));
  const delegating: { node: CanvasNode; names: string[]; at: number }[] = [];
  for (const f of agents) {
    const { fields, body, raw } = parseFile(f.text);
    const name = fileName(f);
    let prompt = body;
    // Copilot agents name their skills in the instructions (as Skill Canvas exports them).
    const note = /\n*When it helps, use these skills: ([^\n]*)$/.exec(prompt);
    const named = note ? [...note[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [];
    if (note) {
      prompt = prompt.slice(0, note.index).trimEnd();
    }
    const tools = list(fields.tools);
    const editable = editableKeys('agent', f.target, fields);
    const node: CanvasNode = {
      ...(f.target === 'claude' ? defined(settingsFrom('agent', fields, editable)) : {}),
      id: newId(),
      kind: 'agent',
      name: humanize(name),
      x: 0,
      y: 0,
      description: str(fields.description),
      prompt: prompt || undefined,
      model: editable.includes('model') ? str(fields.model) : undefined,
      toolsMode: tools.length ? 'only' : 'all',
      tools: tools.join(', ') || undefined,
      extra: extraOf(raw, editable),
    };
    const other: string[] = [];
    for (const s of [...list(fields.skills), ...named]) {
      const target = skillIds.get(slug(s));
      if (target && !edges.some((e) => e.from === node.id && e.to === target)) {
        edges.push({ id: newId(), kind: 'uses', from: node.id, to: target });
      } else if (!target) {
        other.push(s);
      }
    }
    if (other.length) {
      node.skills = other.join(', ');
    }
    nodes.push(node);
    agentIds.set(slug(node.name), node.id);
    const helpers = HELPERS_LINE.exec(prompt);
    if (helpers) {
      delegating.push({ node, names: [...helpers[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]), at: helpers.index });
    }
    if (exportPath('agent', node.name, f.target) === f.path) {
      owned.push({ target: f.target, scope: f.scope, path: f.path });
    }
  }

  // Agents named as helpers become links, once every agent is known. If one isn't on
  // the canvas, the sentence stays in the instructions as written.
  for (const { node, names, at } of delegating) {
    const ids = names.map((s) => agentIds.get(slug(s)));
    if (ids.every((x): x is string => !!x && x !== node.id)) {
      node.prompt = node.prompt!.slice(0, at).trimEnd() || undefined;
      for (const to of new Set(ids)) {
        edges.push({ id: newId(), kind: 'uses', from: node.id, to });
      }
    }
  }
  return { nodes, edges, owned };
}
