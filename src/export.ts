import { CanvasEdge, CanvasModel, CanvasNode, isUses, OUTPUTS, Target } from './model';

/** A file to write, with a path relative to the target's root folder. */
export interface ExportFile {
  path: string;
  content: string;
  kind: 'agent' | 'skill' | 'workflow';
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
}

export interface ExportResult {
  files: ExportFile[];
  warnings: ExportWarning[];
  /** Slash command that runs the workflow, when there is a workflow skill. */
  command?: string;
  /** Exported name per agent/skill block. */
  names: Record<string, string>;
}

/** Root folders per target: in the project, and under the user's home directory. */
export const ROOTS: Record<Target, { project: string; user: string; label: string }> = {
  claude: { project: '.claude', user: '.claude', label: 'Claude Code' },
  copilot: { project: '.github', user: '.copilot', label: 'GitHub Copilot' },
};

const CLAUDE_MODEL_ALIASES = ['inherit', 'sonnet', 'opus', 'haiku', 'fable'];

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

function frontmatter(fields: Record<string, string | string[] | undefined>): string {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      if (value.length) {
        lines.push(`${key}:`, ...value.map((v) => `  - ${yamlScalar(v)}`));
      }
    } else if (oneLine(value)) {
      lines.push(`${key}: ${yamlScalar(oneLine(value))}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n\n`;
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
    return { files, warnings, names };
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
    let description = n.description?.trim();
    if (!description) {
      warn('description', `Add what it's for. The AI reads this to decide when to use this ${n.kind}.`);
      description = `${n.name} (from the ${wfName} workflow).`;
    }
    const prompt = n.prompt?.trim();
    if (!prompt) {
      warn('prompt', n.kind === 'agent' ? 'Add instructions so the agent knows how to work.' : 'Add the instructions this skill should follow.');
    }

    if (n.kind === 'agent') {
      const linked = usedBy(n);
      const linkedTools = linked.filter((t) => t.kind === 'tool').map((t) => t.name.trim()).filter(Boolean);
      const linkedSkills = linked.filter((t) => t.kind === 'skill').map((t) => names[t.id]);
      const restrict = n.toolsMode === 'only' || (n.toolsMode === undefined && !!n.tools?.trim()) || linkedTools.length > 0;
      const tools = restrict ? unique([...list(n.tools), ...linkedTools]) : [];
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
      // Copilot agents have no field for skills, so name them in the instructions.
      if (target === 'copilot' && skills.length) {
        body += `\n\nWhen it helps, use these skills: ${skills.map((s) => `\`${s}\``).join(', ')}.`;
      }
      const fields =
        target === 'claude'
          ? { name, description, tools: tools.join(', '), model, skills }
          : { name, description, tools, model };
      files.push({
        path: target === 'claude' ? `agents/${name}.md` : `agents/${name}.agent.md`,
        content: frontmatter(fields) + `${body}\n`,
        kind: 'agent',
        nodeId: n.id,
      });
    } else {
      files.push({
        path: `skills/${name}/SKILL.md`,
        content:
          frontmatter({
            name,
            description,
            'argument-hint': n.argumentHint,
            'allowed-tools': target === 'claude' ? n.tools : undefined,
          }) + `${prompt || `# ${n.name}`}\n`,
        kind: 'skill',
        nodeId: n.id,
      });
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
    const head = frontmatter({
      name: wfSlug,
      description: model.description?.trim() || `Run the ${wfName} workflow.`,
      'argument-hint': model.argumentHint,
    });
    const body = workflowBody(model, wfName, flow.order, next, names, target);
    const offset = head.split('\n').length - 1;
    const steps: Record<string, number> = {};
    for (const [id, line] of Object.entries(body.steps)) {
      steps[id] = line + offset;
    }
    files.push({ path: `skills/${wfSlug}/SKILL.md`, content: head + body.text, kind: 'workflow', steps });
    command = `/${wfSlug}`;
  }
  return { files, warnings, command, names };
}

/** Splits a generated file into its frontmatter fields and body. */
export function parseFile(text: string): { fields: Record<string, string | string[]>; body: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const fields: Record<string, string | string[]> = {};
  let bodyLines = lines;
  const end = lines[0]?.trim() === '---' ? lines.findIndex((l, i) => i > 0 && l.trim() === '---') : -1;
  if (end > 0) {
    let key: string | undefined;
    for (const line of lines.slice(1, end)) {
      const item = /^\s+-\s*(.*)$/.exec(line);
      if (item && key) {
        const current = fields[key];
        fields[key] = [...(Array.isArray(current) ? current : current ? [current] : []), unquote(item[1])];
        continue;
      }
      const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
      if (kv) {
        key = kv[1];
        const v = kv[2].trim();
        fields[key] = v.startsWith('[') && v.endsWith(']') ? list(v.slice(1, -1)).map(unquote) : unquote(v);
      }
    }
    bodyLines = lines.slice(end + 1);
  }
  return { fields, body: bodyLines.join('\n').replace(/^\n+|\s+$/g, '') };
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
  const { fields, body } = parseFile(text);
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
  patch.description = description === `${n.name} (from the ${wfName} workflow).` ? undefined : description;

  if (n.kind === 'agent') {
    const linked = model.edges.filter((e) => isUses(e) && e.from === n.id).map((e) => model.nodes.find((x) => x.id === e.to)!).filter(Boolean);
    const linkedTools = linked.filter((x) => x.kind === 'tool').map((x) => x.name.trim());
    const { names } = buildExport(model, fallbackName, target);
    const linkedSkills = linked.filter((x) => x.kind === 'skill').map((x) => names[x.id]);
    const tools = arr('tools');
    patch.tools = tools.filter((t) => !linkedTools.includes(t)).join(', ') || undefined;
    patch.toolsMode = tools.length ? 'only' : 'all';
    patch.model = str('model');
    if (target === 'claude') {
      patch.skills = arr('skills').filter((s) => !linkedSkills.includes(s)).join(', ') || undefined;
    }
    const prompt = target === 'copilot' ? body.replace(/\n*When it helps, use these skills: [^\n]*$/, '') : body;
    patch.prompt = prompt && prompt !== `You are ${n.name}.` ? prompt : undefined;
  } else {
    patch.argumentHint = str('argument-hint');
    if (target === 'claude') {
      patch.tools = str('allowed-tools');
    }
    patch.prompt = body && body !== `# ${n.name}` ? body : undefined;
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
  const note = (s: string | undefined, prefix = '') => (oneLine(s) ? ` ${prefix}${oneLine(s)}` : '');
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

  const lines = [`# ${wfName}`, ''];
  if (model.description?.trim()) {
    lines.push(...model.description.trim().split('\n'), '');
  }
  lines.push('Follow these steps. "Go to step N" means continue from that step.', '');
  const steps: Record<string, number> = {};
  order.forEach((n, i) => {
    steps[n.id] = lines.length;
    lines.push(`${i + 1}. ${describe(n)}`);
  });
  return { text: lines.join('\n') + '\n', steps };
}
