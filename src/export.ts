import { Level, LintIssue, lintAgent, lintSkill } from './lint';
import { CanvasEdge, CanvasModel, CanvasNode, isUses, OUTPUTS, SkillFile, Target, TestScenario } from './model';

/** A file to write, with a path relative to the target's root folder. */
export interface ExportFile {
  path: string;
  content: string;
  /** 'reference': an extra file in a skill's folder. 'evals': a skill's test scenarios. */
  kind: 'agent' | 'skill' | 'workflow' | 'reference' | 'evals';
  /** Agent/skill block this file was generated from; unset for the workflow skill. */
  nodeId?: string;
  /** Workflow skill only: line index of each block's step. */
  steps?: Record<string, number>;
}

export interface ExportWarning {
  nodeId?: string;
  /** Side-panel field the warning is about, so it can be shown next to it. */
  field?: string;
  text: string;
  /** 'tip' is advice from the best practices; anything else is a thing to fix. */
  level?: Level;
}

/** Side-panel field for each key the checks in lint.ts report on. */
const LINT_FIELDS: Record<string, string> = {
  when_to_use: 'whenToUse',
  body: 'prompt',
  'allowed-tools': 'tools',
  isolation: 'worktree',
};

export interface ExportResult {
  files: ExportFile[];
  warnings: ExportWarning[];
  /** Slash command that runs the workflow, when there is a workflow skill. */
  command?: string;
  /** Exported name per agent/skill block. */
  names: Record<string, string>;
  /** Step number per block in the workflow, when there is one. */
  steps: Record<string, number>;
}

/** Root folders per target: in the project, and under the user's home directory. */
export const ROOTS: Record<Target, { project: string; user: string; label: string }> = {
  claude: { project: '.claude', user: '.claude', label: 'Claude Code' },
  copilot: { project: '.github', user: '.copilot', label: 'GitHub Copilot' },
};

const CLAUDE_MODEL_ALIASES = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'];

/** Sentence that names the agents an agent can hand work to, at the end of its instructions. */
export const HELPERS_NOTE = 'Hand work to these agents when it helps: ';
/** Finds that sentence; group 1 is the list of names. */
export const HELPERS_LINE = /\n*Hand work to these agents when it helps: ([^\n]*)$/;

/** Agent/skill names: lowercase letters, digits and hyphens, max 64 chars. */
export function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

const oneLine = (s: string | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
const list = (s: string | undefined) =>
  (s ?? '').split(',').map((t) => t.trim()).filter(Boolean);
const unique = (xs: string[]) => [...new Set(xs)];

function yamlScalar(s: string): string {
  // JSON strings are valid YAML double-quoted scalars.
  return /^[A-Za-z0-9][\w .,()/'-]*$/.test(s) ? s : JSON.stringify(s);
}

/** The header of an agent or skill file. `extra` is frontmatter kept as written, after the fields. */
function frontmatter(fields: Record<string, string | string[] | undefined>, extra?: string): string {
  const lines: string[] = [];
  const written = new Set<string>();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      if (value.length) {
        lines.push(`${key}:`, ...value.map((v) => `  - ${yamlScalar(v)}`));
        written.add(key);
      }
    } else if (oneLine(value)) {
      lines.push(`${key}: ${yamlScalar(oneLine(value))}`);
      written.add(key);
    }
  }
  // A kept key the canvas now writes itself (e.g. after switching target) would be a duplicate.
  if (extra?.trim()) {
    lines.push(...parseFile(`---\n${extra}\n---\n`).raw.filter((b) => !written.has(b.key)).map((b) => b.text));
  }
  return `---\n${lines.join('\n')}\n---\n\n`;
}

/** Description written for a block that has none yet, worded the way the guide asks for. */
const placeholder = (name: string, wfName: string) =>
  `Handles the "${name}" step of the ${wfName} workflow. Use when running ${wfName}.`;
/** Placeholder from versions before 0.3.0, recognised when reading a file back. */
const oldPlaceholder = (name: string, wfName: string) => `${name} (from the ${wfName} workflow).`;

/** The default workflow description: what it does, and when to run it. */
function workflowDescription(wfName: string, order: CanvasNode[]): string {
  const note = oneLine(order.find((n) => n.kind === 'input')?.prompt).replace(/[.!]+$/, '');
  // "A bug report" reads as "a bug report" mid-sentence; acronyms like "PDF" stay.
  const given = note ? `, or gives ${/^[A-Z](?![A-Z])/.test(note) ? note[0].toLowerCase() + note.slice(1) : note}` : '';
  return `Runs the ${wfName} workflow step by step. Use when the user asks to run ${wfName}${given}.`;
}

/** A path inside a skill's folder, with forward slashes; undefined if it would leave the folder. */
export function skillFilePath(p: string): string | undefined {
  const s = p.trim().replace(/\\/g, '/');
  const parts = s.split('/').filter((x) => x && x !== '.');
  if (!parts.length || s.startsWith('/') || /^[a-z]:/i.test(s) || parts.includes('..')) {
    return undefined;
  }
  const path = parts.join('/');
  return path.toLowerCase() === 'skill.md' ? undefined : path;
}

const MORE_DETAIL = '## More detail';
const DETAIL_LINE = /^- \[([^\]]+)\]\(([^)\s]+)\)(?::\s*(.*))?$/;

/** The list of extra files at the end of SKILL.md, for those the instructions don't link to yet. */
function moreDetail(refs: SkillFile[], prompt: string): string {
  const unlinked = refs.filter((r) => !prompt.includes(`](${r.path})`));
  if (!unlinked.length) {
    return '';
  }
  const items = unlinked.map((r) => `- [${r.path}](${r.path})${oneLine(r.when) ? `: ${oneLine(r.when)}` : ''}`);
  return `\n\n${MORE_DETAIL}\n\n${items.join('\n')}`;
}

/**
 * Takes the generated list of extra files off the end of SKILL.md, with the "when" text of
 * each. Undefined when there's no such list, or it has lines the canvas didn't write.
 */
export function stripMoreDetail(body: string, paths: string[]): { body: string; when: Record<string, string | undefined> } | undefined {
  const at = body.lastIndexOf(MORE_DETAIL);
  if (at < 0 || (at > 0 && body[at - 1] !== '\n')) {
    return undefined;
  }
  const when: Record<string, string | undefined> = {};
  for (const line of body.slice(at + MORE_DETAIL.length).split('\n').filter((l) => l.trim())) {
    const m = DETAIL_LINE.exec(line.trim());
    if (!m || m[1] !== m[2] || !paths.includes(m[2])) {
      return undefined;
    }
    when[m[2]] = m[3]?.trim() || undefined;
  }
  return { body: body.slice(0, at).replace(/\s+$/, ''), when };
}

/** A skill's test scenarios in the guide's evaluation format. */
function evalsJson(skill: string, scenarios: TestScenario[]): string {
  const lines = (s: string | undefined) => (s ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
  const items = scenarios.map((e) => ({ skills: [skill], query: e.query.trim(), files: list(e.files), expected_behavior: lines(e.expected) }));
  return `${JSON.stringify(items, null, 2)}\n`;
}

/** Folders in a skill's folder to remove, deepest first, once a file in them is gone and they're empty. */
export function foldersToTidy(path: string): string[] {
  const parts = path.split('/');
  if (parts[0] !== 'skills' || parts.length < 3) {
    return [];
  }
  const out: string[] = [];
  for (let i = parts.length - 1; i >= 2; i--) {
    out.push(parts.slice(0, i).join('/'));
  }
  return out;
}

/**
 * Turns a canvas into agent and skill files: one agent per Agent block, one skill
 * per Skill block, and a workflow skill that walks the steps when there are several.
 */
export function buildExport(model: CanvasModel, fallbackName: string, target: Target = 'claude'): ExportResult {
  const files: ExportFile[] = [];
  const warnings: ExportWarning[] = [];
  const names: Record<string, string> = {};
  if (!model.nodes.length) {
    return { files, warnings, names, steps: {} };
  }

  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const edges = model.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const next = edges.filter((e) => !isUses(e));
  const uses = edges.filter(isUses);
  const usedBy = (n: CanvasNode) => uses.filter((e) => e.from === n.id).map((e) => byId.get(e.to)!);

  const wfName = model.name?.trim() || fallbackName;
  const wfSlug = slug(wfName) || 'workflow';

  // Names first, so agents can refer to the skills they use.
  const taken = { agent: new Set<string>(), skill: new Set<string>([wfSlug]) };
  for (const n of model.nodes) {
    if (n.kind !== 'agent' && n.kind !== 'skill') {
      continue;
    }
    const base = slug(n.name) || n.kind;
    let name = base;
    for (let i = 2; taken[n.kind].has(name); i++) {
      name = `${base}-${i}`;
    }
    if (name !== base) {
      warnings.push({ nodeId: n.id, field: 'name', text: `Saved as "${name}" because another ${n.kind} is already called "${base}".` });
    }
    taken[n.kind].add(name);
    names[n.id] = name;
  }

  for (const n of model.nodes) {
    if (n.kind !== 'agent' && n.kind !== 'skill') {
      continue;
    }
    const name = names[n.id];
    const warn = (field: string, text: string) => warnings.push({ nodeId: n.id, field, text });
    const check = (issues: LintIssue[]) =>
      issues.forEach((i) => warnings.push({ nodeId: n.id, field: LINT_FIELDS[i.key] ?? i.key, text: i.text, level: i.level }));
    // An empty description is reported by the checks below.
    const description = n.description?.trim() || placeholder(n.name, wfName);
    const prompt = n.prompt?.trim();
    if (!prompt) {
      warn('prompt', n.kind === 'agent' ? 'Add instructions so the agent knows how to work.' : 'Add the instructions this skill should follow.');
    }

    if (n.kind === 'agent') {
      const linked = usedBy(n);
      const linkedTools = linked.filter((t) => t.kind === 'tool').map((t) => t.name.trim()).filter(Boolean);
      const linkedSkills = linked.filter((t) => t.kind === 'skill').map((t) => names[t.id]);
      // Agents it can hand work to: it needs the Agent tool, and is told their names.
      const helpers = linked.filter((t) => t.kind === 'agent').map((t) => names[t.id]);
      const restrict = n.toolsMode === 'only' || (n.toolsMode === undefined && !!n.tools?.trim()) || linkedTools.length > 0;
      const delegates = target === 'claude' && helpers.length && !list(n.tools).some((t) => /^Agent\b/.test(t)) ? ['Agent'] : [];
      const tools = restrict ? unique([...list(n.tools), ...linkedTools, ...delegates]) : [];
      if (restrict && !tools.length) {
        warn('tools', 'Choose at least one tool, or switch to "All tools".');
      }
      const skills = unique([...linkedSkills, ...list(n.skills).map(slug).filter(Boolean)]);

      let model = n.model?.trim();
      if (target === 'copilot' && model && CLAUDE_MODEL_ALIASES.includes(model)) {
        if (model !== 'inherit') {
          warn('model', `Copilot doesn't use "${model}". Enter a Copilot model name, or leave it empty.`);
        }
        model = undefined;
      }

      let body = prompt || `You are ${n.name}.`;
      if (helpers.length) {
        body += `\n\n${HELPERS_NOTE}${helpers.map((s) => `\`${s}\``).join(', ')}.`;
      }
      // Copilot agents have no field for skills, so name them in the instructions.
      if (target === 'copilot' && skills.length) {
        body += `\n\nWhen it helps, use these skills: ${skills.map((s) => `\`${s}\``).join(', ')}.`;
      }
      const fields =
        target === 'claude'
          ? {
              name,
              description,
              tools: tools.join(', '),
              disallowedTools: n.disallowedTools,
              model,
              effort: n.effort,
              maxTurns: n.maxTurns ? String(n.maxTurns) : undefined,
              permissionMode: n.permissionMode,
              memory: n.memory,
              isolation: n.worktree ? 'worktree' : undefined,
              color: n.color,
              skills,
            }
          : { name, description, tools, model };
      check(lintAgent({
        name,
        description: n.description,
        tools: tools.join(', '),
        disallowedTools: n.disallowedTools,
        model,
        effort: n.effort,
        permissionMode: n.permissionMode,
        memory: n.memory,
        color: n.color,
        maxTurns: n.maxTurns,
        target,
      }));
      files.push({
        path: target === 'claude' ? `agents/${name}.md` : `agents/${name}.agent.md`,
        content: frontmatter(fields, n.extra) + `${body}\n`,
        kind: 'agent',
        nodeId: n.id,
      });
    } else {
      const claude = target === 'claude';
      const refs: SkillFile[] = [];
      for (const r of n.references ?? []) {
        const path = skillFilePath(r.path ?? '');
        if (!path) {
          warn('references', r.path?.trim()
            ? `"${r.path}" can't be saved: extra files have to stay inside the skill's folder.`
            : 'Give each extra file a name.');
        } else if (refs.some((x) => x.path === path)) {
          warn('references', `Two extra files are called ${path}. Only the first is saved.`);
        } else {
          refs.push({ ...r, path });
        }
      }
      const scenarios = (n.evals ?? []).filter((e) => e.query?.trim());
      const other = n.otherFiles ?? [];
      const body = (prompt || `# ${n.name}`) + moreDetail(refs, prompt ?? '');
      check(lintSkill({
        name,
        description: n.description,
        whenToUse: n.whenToUse,
        body,
        tools: n.tools,
        model: n.model,
        effort: n.effort,
        target,
        references: refs,
        files: [...other, ...refs.map((r) => r.path), ...(scenarios.length ? ['evals/evals.json'] : [])],
        // Scenarios kept as they were found (another format) still count.
        evalCount: !scenarios.length && other.includes('evals/evals.json') ? undefined : scenarios.length,
      }));
      files.push({
        path: `skills/${name}/SKILL.md`,
        content:
          frontmatter({
            name,
            description,
            when_to_use: claude ? n.whenToUse : undefined,
            'argument-hint': n.argumentHint,
            'allowed-tools': claude ? n.tools : undefined,
            'disable-model-invocation': claude && n.invocation === 'user' ? 'true' : undefined,
            'user-invocable': claude && n.invocation === 'claude' ? 'false' : undefined,
            context: claude && n.fork ? 'fork' : undefined,
            agent: claude && n.fork ? n.forkAgent : undefined,
            model: claude ? n.model : undefined,
            effort: claude ? n.effort : undefined,
            paths: claude ? list(n.paths) : undefined,
          }, n.extra) + `${body}\n`,
        kind: 'skill',
        nodeId: n.id,
      });
      for (const r of refs) {
        files.push({ path: `skills/${name}/${r.path}`, content: `${r.content.replace(/\s+$/, '')}\n`, kind: 'reference', nodeId: n.id });
      }
      if (scenarios.length) {
        files.push({ path: `skills/${name}/evals/evals.json`, content: evalsJson(name, scenarios), kind: 'evals', nodeId: n.id });
      }
    }
  }

  for (const n of model.nodes) {
    if (n.kind === 'loop' && !n.maxIterations) {
      warnings.push({ nodeId: n.id, field: 'maxIterations', text: 'Set how many times it can repeat, so it always finishes.' });
    }
  }

  const flow = workflowSteps(model.nodes, next, uses);
  for (const n of flow.unreachable) {
    const text =
      n.kind === 'agent' || n.kind === 'skill'
        ? `Not connected to the other steps. It's still saved as its own ${n.kind}.`
        : 'Not connected to the other steps, so it is left out.';
    warnings.push({ nodeId: n.id, text });
  }

  let command: string | undefined;
  if (flow.order.length >= 2) {
    const description = model.description?.trim() || workflowDescription(wfName, flow.order);
    for (const i of lintSkill({ name: wfSlug, description, target })) {
      if (i.key === 'name' || i.key === 'description') {
        warnings.push({ field: i.key === 'description' ? 'description' : undefined, text: i.text, level: i.level });
      }
    }
    const head = frontmatter({ name: wfSlug, description, 'argument-hint': model.argumentHint });
    const body = workflowBody(model, wfName, flow.order, next, names, target);
    const offset = head.split('\n').length - 1;
    const steps: Record<string, number> = {};
    for (const [id, line] of Object.entries(body.steps)) {
      steps[id] = line + offset;
    }
    files.push({ path: `skills/${wfSlug}/SKILL.md`, content: head + body.text, kind: 'workflow', steps });
    command = `/${wfSlug}`;
  }
  const stepNumbers = flow.order.length >= 2 ? Object.fromEntries(flow.order.map((n, i) => [n.id, i + 1])) : {};
  return { files, warnings, command, names, steps: stepNumbers };
}

/** A top-level frontmatter key exactly as written: its line and the indented lines under it. */
export interface RawKey {
  key: string;
  text: string;
  /** Line of the key in the file, from 0. */
  line: number;
}

export interface ParsedFile {
  fields: Record<string, string | string[]>;
  body: string;
  /** Every top-level key as written, in order. Lines before the first key come back as key `#`. */
  raw: RawKey[];
  /** Line where the body text starts, from 0. */
  bodyLine: number;
}

/** Splits an agent or skill file into its frontmatter fields and body. */
export function parseFile(text: string): ParsedFile {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const fields: Record<string, string | string[]> = {};
  const raw: RawKey[] = [];
  let start = 0;
  const end = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  if (end > 0) {
    for (let i = 1; i < end; i++) {
      const key = /^([A-Za-z][\w-]*):/.exec(lines[i]);
      if (key) {
        raw.push({ key: key[1], text: lines[i], line: i });
      } else if (lines[i].startsWith('#')) {
        // A comment of its own is kept as written, even next to keys the canvas rewrites.
        raw.push({ key: '#', text: lines[i], line: i });
      } else if (raw.length) {
        raw[raw.length - 1].text += `\n${lines[i]}`;
      } else if (lines[i].trim()) {
        raw.push({ key: '#', text: lines[i], line: i });
      }
    }
    for (const b of raw) {
      b.text = b.text.replace(/\s+$/, '');
      if (b.key !== '#') {
        fields[b.key] = valueOf(b.text);
      }
    }
    start = end + 1;
  }
  while (start < lines.length - 1 && !lines[start].trim()) {
    start++;
  }
  return { fields, body: lines.slice(start).join('\n').replace(/\s+$/, ''), raw, bodyLine: start };
}

/** The value of one top-level key: a string, a list, or for nested maps the text under the key. */
/** A value without a trailing `# comment`. A `#` inside quotes or a word (like C#) stays. */
function stripComment(v: string): string {
  const quoted = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*(#.*)?$/.exec(v.trim());
  return quoted ? quoted[1] : v.replace(/(^|\s)#.*$/, '').trim();
}

function valueOf(block: string): string | string[] {
  const [first, ...rest] = block.split('\n');
  const v = stripComment(first.slice(first.indexOf(':') + 1));
  const filled = rest.filter((l) => l.trim() && !/^\s*#/.test(l));
  if (/^[>|][-+]?\d*$/.test(v)) {
    const indent = Math.min(...filled.map((l) => /^\s*/.exec(l)![0].length));
    const text = rest.map((l) => l.slice(indent).trimEnd()).join('\n').trim();
    // Folded (>) joins lines into paragraphs; literal (|) keeps them.
    return v[0] === '|' ? text : text.split(/\n\s*\n/).map((p) => p.split('\n').map((s) => s.trim()).join(' ')).join('\n');
  }
  if (!v) {
    if (filled.length && filled.every((l) => /^\s*-(\s|$)/.test(l))) {
      return filled.map((l) => unquote(stripComment(l.replace(/^\s*-\s*/, ''))));
    }
    return rest.join('\n').trim();
  }
  if (v.startsWith('[') && v.endsWith(']')) {
    return list(v.slice(1, -1)).map(unquote);
  }
  // A plain or quoted value, possibly continued on the next lines.
  return unquote([v, ...filled.map((l) => stripComment(l))].join(' '));
}

const CLAUDE_AGENT_KEYS = ['name', 'description', 'tools', 'disallowedTools', 'model', 'effort', 'maxTurns', 'permissionMode', 'memory', 'isolation', 'color', 'skills'];
const CLAUDE_SKILL_KEYS = [
  'name', 'description', 'when_to_use', 'argument-hint', 'allowed-tools', 'disable-model-invocation',
  'user-invocable', 'context', 'agent', 'model', 'effort', 'paths',
];

/** Frontmatter keys the canvas edits for a block. Everything else is kept as written, in `extra`. */
export function knownKeys(kind: 'agent' | 'skill', target: Target): string[] {
  if (kind === 'agent') {
    return target === 'claude' ? CLAUDE_AGENT_KEYS : ['name', 'description', 'tools', 'model'];
  }
  return target === 'claude' ? CLAUDE_SKILL_KEYS : ['name', 'description', 'argument-hint'];
}

/** YAML booleans as Claude Code reads them; undefined when it isn't one. */
function bool(v: string | string[] | undefined): boolean | undefined {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return ['true', 'yes', 'on', '1'].includes(s) ? true : ['false', 'no', 'off', '0'].includes(s) ? false : undefined;
}

/**
 * The known keys whose values fit the canvas's fields. The rest are kept as written, e.g. a
 * list of fallback models (Copilot), `context` other than fork, or a skill hidden from everyone.
 */
export function editableKeys(kind: 'agent' | 'skill', target: Target, fields: ParsedFile['fields']): string[] {
  const keep = new Set<string>();
  const model = fields.model;
  if (Array.isArray(model) && model.length > 1) {
    keep.add('model');
  }
  if (fields.context !== 'fork') {
    keep.add('agent'); // only means something for skills that run on their own
    if (fields.context !== undefined) {
      keep.add('context');
    }
  }
  const manualOnly = bool(fields['disable-model-invocation']);
  const aiOnly = bool(fields['user-invocable']);
  if ((fields['disable-model-invocation'] !== undefined && manualOnly === undefined) ||
      (fields['user-invocable'] !== undefined && aiOnly === undefined) || (manualOnly && aiOnly === false)) {
    keep.add('disable-model-invocation').add('user-invocable');
  }
  if (fields.maxTurns !== undefined && !/^[1-9]\d*$/.test(String(fields.maxTurns))) {
    keep.add('maxTurns');
  }
  if (fields.isolation !== undefined && fields.isolation !== 'worktree') {
    keep.add('isolation');
  }
  return knownKeys(kind, target).filter((k) => !keep.has(k));
}

/** The Claude Code settings in a parsed file, as block fields. Only keys in `editable` are read. */
export function settingsFrom(kind: 'agent' | 'skill', fields: ParsedFile['fields'], editable: string[]): Partial<CanvasNode> {
  const get = (k: string) => {
    const v = editable.includes(k) ? fields[k] : undefined;
    return (Array.isArray(v) ? v.join(', ') : v)?.trim() || undefined;
  };
  if (kind === 'agent') {
    const turns = get('maxTurns');
    return {
      disallowedTools: get('disallowedTools'),
      effort: get('effort'),
      maxTurns: turns ? Number(turns) : undefined,
      permissionMode: get('permissionMode'),
      memory: get('memory'),
      worktree: get('isolation') === 'worktree' || undefined,
      color: get('color'),
    };
  }
  return {
    whenToUse: get('when_to_use'),
    invocation: bool(get('disable-model-invocation')) ? 'user' : bool(get('user-invocable')) === false ? 'claude' : undefined,
    fork: get('context') === 'fork' || undefined,
    forkAgent: get('context') === 'fork' ? get('agent') : undefined,
    model: get('model'),
    effort: get('effort'),
    paths: get('paths'),
  };
}

/** The keys of a parsed file that the canvas doesn't edit, as written. */
export function extraOf(raw: RawKey[], known: string[]): string | undefined {
  return raw.filter((b) => !known.includes(b.key)).map((b) => b.text).join('\n') || undefined;
}

function unquote(v: string): string {
  const s = v.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      return JSON.parse(s);
    } catch {
      return s.slice(1, -1);
    }
  }
  return s.startsWith("'") && s.endsWith("'") ? s.slice(1, -1).replace(/''/g, "'") : s;
}

/**
 * Reads an edited agent or skill file back into block fields. Parts that come
 * from the canvas (linked skills and tools, placeholder text) are left out.
 */
export function readBack(
  text: string,
  model: CanvasModel,
  nodeId: string,
  fallbackName: string,
  target: Target
): Partial<CanvasNode> | undefined {
  const n = model.nodes.find((x) => x.id === nodeId);
  if (!n || (n.kind !== 'agent' && n.kind !== 'skill')) {
    return undefined;
  }
  const { fields, body, raw } = parseFile(text);
  const str = (k: string) => {
    const v = fields[k];
    return Array.isArray(v) ? v.join(', ') : v?.trim() || undefined;
  };
  const arr = (k: string) => (Array.isArray(fields[k]) ? (fields[k] as string[]) : list(str(k)));
  const wfName = model.name?.trim() || fallbackName;
  const patch: Partial<CanvasNode> = {};

  const name = str('name');
  if (name && slug(name) !== slug(n.name)) {
    patch.name = name;
  }
  const description = str('description');
  patch.description =
    description === placeholder(n.name, wfName) || description === oldPlaceholder(n.name, wfName) ? undefined : description;
  const editable = editableKeys(n.kind, target, fields);
  patch.extra = extraOf(raw, editable);
  // Claude Code settings stay as they are while editing the Copilot version of a file.
  if (target === 'claude') {
    Object.assign(patch, settingsFrom(n.kind, fields, editable));
  }

  if (n.kind === 'agent') {
    const linked = model.edges.filter((e) => isUses(e) && e.from === n.id).map((e) => model.nodes.find((x) => x.id === e.to)!).filter(Boolean);
    const linkedTools = linked.filter((x) => x.kind === 'tool').map((x) => x.name.trim());
    const { names } = buildExport(model, fallbackName, target);
    const linkedSkills = linked.filter((x) => x.kind === 'skill').map((x) => names[x.id]);
    const tools = arr('tools');
    // The Agent tool added for linked agents comes from the canvas, like linked tools.
    const added = linked.some((x) => x.kind === 'agent') && !list(n.tools).includes('Agent') ? ['Agent'] : [];
    patch.tools = tools.filter((t) => !linkedTools.includes(t) && !added.includes(t)).join(', ') || undefined;
    patch.toolsMode = tools.length ? 'only' : 'all';
    patch.model = editable.includes('model') ? str('model') : undefined;
    if (target === 'claude') {
      patch.skills = arr('skills').filter((s) => !linkedSkills.includes(s)).join(', ') || undefined;
    }
    const own = target === 'copilot' ? body.replace(/\n*When it helps, use these skills: [^\n]*$/, '') : body;
    const prompt = own.replace(HELPERS_LINE, '');
    patch.prompt = prompt && prompt !== `You are ${n.name}.` ? prompt : undefined;
  } else {
    patch.argumentHint = str('argument-hint');
    if (target === 'claude') {
      patch.tools = str('allowed-tools');
    }
    // The list of extra files is written by the canvas; only its "when" texts are read back.
    const refs = n.references ?? [];
    // Paths as export writes them.
    const pathOf = (r: SkillFile) => skillFilePath(r.path ?? '') ?? r.path;
    const stripped = refs.length ? stripMoreDetail(body, refs.map(pathOf)) : undefined;
    if (stripped && refs.some((r) => pathOf(r) in stripped.when && (stripped.when[pathOf(r)] ?? '') !== oneLine(r.when))) {
      patch.references = refs.map((r) => (pathOf(r) in stripped.when ? { ...r, when: stripped.when[pathOf(r)] } : r));
    }
    const instructions = stripped ? stripped.body : body;
    patch.prompt = instructions && instructions !== `# ${n.name}` ? instructions : undefined;
  }
  return patch;
}

const portOf = (n: CanvasNode, port?: string) => port ?? OUTPUTS[n.kind]?.[0];

function edgesFrom(n: CanvasNode, next: CanvasEdge[]) {
  const order = OUTPUTS[n.kind] ?? [];
  return next
    .filter((e) => e.from === n.id)
    .sort((a, b) => order.indexOf(portOf(n, a.fromPort)!) - order.indexOf(portOf(n, b.fromPort)!));
}

/**
 * Orders the steps depth-first from where the workflow starts, so branches read in
 * order. Blocks that are only used by an agent are capabilities, not steps.
 */
function workflowSteps(nodes: CanvasNode[], next: CanvasEdge[], uses: CanvasEdge[]) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const inFlow = (n: CanvasNode) => next.some((e) => e.from === n.id || e.to === n.id);
  const usesOnly = (n: CanvasNode) => uses.some((e) => e.to === n.id) && !inFlow(n);
  const candidates = nodes.filter((n) => !usesOnly(n));

  // Start from blocks nothing leads into, Input blocks first, then left to right.
  const byStart = (a: CanvasNode, b: CanvasNode) =>
    Number(a.kind !== 'input') - Number(b.kind !== 'input') || a.x - b.x;
  const roots = candidates.filter((n) => !next.some((e) => e.to === n.id)).sort(byStart);
  const order: CanvasNode[] = [];
  const seen = new Set<string>();
  const visit = (n: CanvasNode | undefined) => {
    if (!n || seen.has(n.id)) {
      return;
    }
    seen.add(n.id);
    order.push(n);
    for (const e of edgesFrom(n, next)) {
      visit(byId.get(e.to));
    }
  };
  const connected = roots.filter(inFlow);
  // A lone block is the whole workflow only when nothing is connected.
  (connected.length ? connected : roots.slice(0, 1)).forEach(visit);
  // Connected blocks in a cycle with no way in (e.g. a loop without an Input).
  candidates.filter(inFlow).sort(byStart).forEach(visit);
  const unreachable = candidates.filter((n) => !seen.has(n.id));
  return { order, unreachable };
}

function workflowBody(
  model: CanvasModel,
  wfName: string,
  order: CanvasNode[],
  next: CanvasEdge[],
  names: Record<string, string>,
  target: Target
) {
  const num = new Map(order.map((n, i) => [n.id, i + 1]));
  const targets = (n: CanvasNode, port?: string) =>
    edgesFrom(n, next)
      .filter((e) => num.has(e.to) && (port === undefined || portOf(n, e.fromPort) === port))
      .map((e) => `step ${num.get(e.to)}`);
  const join = (refs: string[]) =>
    refs.length > 1 ? `${refs.slice(0, -1).join(', ')} and ${refs[refs.length - 1]}` : refs[0];
  const goTo = (refs: string[]) => (refs.length ? `go to ${join(refs)}` : 'stop');
  const then = (n: CanvasNode) => `Then ${goTo(targets(n))}.`;
  // A note becomes its own sentence, ending in a full stop unless it already has punctuation.
  const note = (s: string | undefined, prefix = '') => {
    const t = oneLine(s);
    return t ? ` ${prefix}${t}${/[.?!]$/.test(t) ? '' : '.'}` : '';
  };
  const agentWord = target === 'claude' ? 'subagent' : 'custom agent';
  // Bold step title, ending in a period unless the name already ends in punctuation.
  const title = (prefix: string, name: string) => `**${prefix}${name}${/[.?!:]$/.test(name) ? '' : '.'}**`;

  const describe = (n: CanvasNode): string => {
    switch (n.kind) {
      case 'input':
        return `${title('Start: ', n.name)}${note(n.prompt, 'The user provides: ')} ${then(n)}`;
      case 'agent':
        return `${title('', n.name)} Delegate to the \`${names[n.id]}\` ${agentWord}. ${then(n)}`;
      case 'skill':
        return `${title('', n.name)} Use the \`${names[n.id]}\` skill. ${then(n)}`;
      case 'tool':
        return `${title('Tool: ', n.name)}${note(n.prompt)} ${then(n)}`;
      case 'output':
        return `${title('Finish: ', n.name)}${note(n.prompt, 'Deliver: ')} Stop here.`;
      case 'if': {
        const cond = oneLine(n.condition) || n.name;
        return `${title('Decide: ', n.name)} Check: ${cond}. If yes, ${goTo(targets(n, 'true'))}. If no, ${goTo(targets(n, 'false'))}.`;
      }
      case 'loop': {
        const limit = n.maxIterations ? `up to ${n.maxIterations} times` : 'as needed';
        const cond = oneLine(n.condition) ? ` while ${oneLine(n.condition)}` : '';
        return (
          `${title('Loop: ', n.name)} Repeat ${limit}${cond}, counting iterations. ` +
          `Each iteration, ${goTo(targets(n, 'body'))}; a step that leads back here starts the next iteration. ` +
          `When the loop ends, ${goTo(targets(n, 'done'))}.`
        );
      }
      default:
        return `${title('', n.name)} ${then(n)}`;
    }
  };

  const prefix: Partial<Record<CanvasNode['kind'], string>> = { input: 'Start: ', output: 'Finish: ', tool: 'Tool: ', if: 'Decide: ', loop: 'Loop: ' };
  const lines = [`# ${wfName}`, ''];
  if (model.description?.trim()) {
    lines.push(...model.description.trim().split('\n'), '');
  }
  // The guide's progress checklist, so no step is skipped.
  lines.push(
    'Copy this checklist and check off each step as you go:',
    '',
    '```',
    ...order.map((n, i) => `- [ ] ${i + 1}. ${prefix[n.kind] ?? ''}${oneLine(n.name)}`),
    '```',
    ''
  );
  lines.push('Follow these steps. "Go to step N" means continue from that step.', '');
  const steps: Record<string, number> = {};
  order.forEach((n, i) => {
    steps[n.id] = lines.length;
    lines.push(`${i + 1}. ${describe(n)}`);
  });
  return { text: lines.join('\n') + '\n', steps };
}
