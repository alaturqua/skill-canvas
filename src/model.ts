export type NodeKind = 'input' | 'agent' | 'skill' | 'tool' | 'output' | 'if' | 'loop';

/** Which tool the canvas exports for. */
export type Target = 'claude' | 'copilot';

/** Where an export was written: the project folder or the user's home folder. */
export type Scope = 'project' | 'user';

/** Output ports per kind, in display order. The first is the default for edges without `fromPort`. */
export const OUTPUTS: Record<NodeKind, string[]> = {
  input: ['out'],
  agent: ['out'],
  skill: ['out'],
  tool: ['out'],
  output: [],
  if: ['true', 'false'],
  loop: ['body', 'done'],
};

export interface CanvasNode {
  id: string;
  kind: NodeKind;
  name: string;
  x: number;
  y: number;
  /** Agent/skill: when the AI should use it (frontmatter `description`). */
  description?: string;
  /** Agent: instructions (system prompt). Skill: instructions. Input/output/tool: notes. */
  prompt?: string;
  /** Agent: inherit | sonnet | opus | haiku | fable, or a Copilot model name. */
  model?: string;
  /** Agent: `tools`. Skill: `allowed-tools` (Claude Code). Comma-separated. */
  tools?: string;
  /** Agent: 'all' tools, or 'only' the listed and linked ones. */
  toolsMode?: 'all' | 'only';
  /** Agent (Claude Code): extra skills to preload, besides linked Skill blocks. Comma-separated. */
  skills?: string;
  /** Skill: `argument-hint`, shown when invoked as /name. */
  argumentHint?: string;
  /** If: condition. Loop: repeat while. */
  condition?: string;
  /** Loop: maximum iterations. */
  maxIterations?: number;
}

export interface CanvasEdge {
  id: string;
  from: string;
  /** Output port on the source node: 'out', or 'true'/'false' (if), 'body'/'done' (loop). */
  fromPort?: string;
  to: string;
  /** 'next' (default): step order. 'uses': an agent can use a skill or tool; not a step. */
  kind?: 'next' | 'uses';
}

export interface CanvasModel {
  version: 1;
  /** Workflow name; defaults to the file name. */
  name?: string;
  /** When to run this workflow. */
  description?: string;
  /** Workflow skill `argument-hint`. */
  argumentHint?: string;
  /** Export format; defaults to Claude Code. */
  target?: Target;
  /** What the last export wrote, so the next one can update or remove those files. */
  lastExport?: { target: Target; scope: Scope; files: string[] };
  nodes: CanvasNode[];
  edges: CanvasEdge[];
}

export const emptyModel = (): CanvasModel => ({ version: 1, nodes: [], edges: [] });

export const isUses = (e: CanvasEdge) => e.kind === 'uses';

/**
 * Reads a canvas file. An empty file is a new, empty canvas; anything that isn't a
 * canvas object comes back with an `error`, so callers can refuse to overwrite it.
 */
export function readModel(text: string): { model: CanvasModel; error?: string } {
  if (!text.trim()) {
    return { model: emptyModel() };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { model: emptyModel(), error: e instanceof Error ? e.message : String(e) };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { model: emptyModel(), error: 'The file does not contain a canvas.' };
  }
  return { model: fromRaw(raw as Record<string, any>) };
}

/** Reads a canvas file, falling back to an empty canvas when it can't be read. */
export function parseModel(text: string): CanvasModel {
  return readModel(text).model;
}

function fromRaw(raw: Record<string, any>): CanvasModel {
  const last = raw.lastExport;
  return {
    version: 1,
    name: typeof raw.name === 'string' ? raw.name : undefined,
    description: typeof raw.description === 'string' ? raw.description : undefined,
    argumentHint: typeof raw.argumentHint === 'string' ? raw.argumentHint : undefined,
    target: raw.target === 'copilot' ? 'copilot' : raw.target === 'claude' ? 'claude' : undefined,
    lastExport:
      last && (last.target === 'claude' || last.target === 'copilot') &&
      (last.scope === 'project' || last.scope === 'user') && Array.isArray(last.files)
        ? { target: last.target, scope: last.scope, files: last.files.filter((f: unknown) => typeof f === 'string') }
        : undefined,
    nodes: Array.isArray(raw.nodes) ? raw.nodes : [],
    edges: Array.isArray(raw.edges) ? raw.edges : [],
  };
}
