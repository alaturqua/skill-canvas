import { parseFile, slug } from './export';
import { CanvasEdge, CanvasNode, Scope, Target } from './model';

/** An agent or skill file found on disk. */
export interface FoundFile {
  /** Path relative to the target's root folder, e.g. `agents/reviewer.md` or `skills/notes/SKILL.md`. */
  path: string;
  text: string;
  kind: 'agent' | 'skill';
  target: Target;
  scope: Scope;
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

/** The name a file is known by: a skill's folder, or an agent's `name` (falling back to its file name). */
export function fileName(f: Pick<FoundFile, 'path' | 'text' | 'kind'>): string {
  const parts = f.path.split('/');
  if (f.kind === 'skill') {
    return parts[parts.length - 2] ?? 'skill';
  }
  const fromFile = parts[parts.length - 1].replace(/\.agent\.md$|\.md$/i, '');
  return str(parseFile(f.text).fields.name) ?? fromFile;
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
    const { fields, body } = parseFile(f.text);
    const name = fileName(f);
    const node: CanvasNode = {
      id: newId(),
      kind: 'skill',
      name: humanize(name),
      x: 0,
      y: 0,
      description: str(fields.description),
      prompt: body || undefined,
      argumentHint: str(fields['argument-hint']),
      tools: list(fields['allowed-tools']).join(', ') || undefined,
    };
    nodes.push(node);
    skillIds.set(slug(node.name), node.id);
    if (exportPath('skill', node.name, f.target) === f.path) {
      owned.push({ target: f.target, scope: f.scope, path: f.path });
    }
  }

  for (const f of agents) {
    const { fields, body } = parseFile(f.text);
    const name = fileName(f);
    let prompt = body;
    // Copilot agents name their skills in the instructions (as Skill Canvas exports them).
    const note = /\n*When it helps, use these skills: ([^\n]*)$/.exec(prompt);
    const named = note ? [...note[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]) : [];
    if (note) {
      prompt = prompt.slice(0, note.index).trimEnd();
    }
    const tools = list(fields.tools);
    const node: CanvasNode = {
      id: newId(),
      kind: 'agent',
      name: humanize(name),
      x: 0,
      y: 0,
      description: str(fields.description),
      prompt: prompt || undefined,
      model: str(fields.model),
      toolsMode: tools.length ? 'only' : 'all',
      tools: tools.join(', ') || undefined,
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
    if (exportPath('agent', node.name, f.target) === f.path) {
      owned.push({ target: f.target, scope: f.scope, path: f.path });
    }
  }
  return { nodes, edges, owned };
}
