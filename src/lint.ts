import type { Target } from './model';

/**
 * Checks for agent and skill files, from Anthropic's skill authoring best practices
 * (platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) and the
 * Claude Code skill and subagent references. Used by the canvas and the text editor.
 */

/** 'fix': it will be rejected, cut off or ignored. 'tip': advice from the guide. */
export type Level = 'fix' | 'tip';

export interface LintIssue {
  /** Frontmatter key the issue is about, or `body`, `references` or `evals`. */
  key: string;
  text: string;
  level: Level;
}

export interface SkillLint {
  name: string;
  description?: string;
  whenToUse?: string;
  body?: string;
  /** `allowed-tools`. */
  tools?: string;
  model?: string;
  effort?: string;
  target: Target;
  /** The skill's folder name, when known. */
  folder?: string;
  /** Extra files in the skill folder that the canvas writes, with their text. */
  references?: { path: string; content: string }[];
  /** Every file in the skill folder besides SKILL.md, when known. */
  files?: string[];
  /** Number of test scenarios, when known. */
  evalCount?: number;
}

export interface AgentLint {
  name: string;
  description?: string;
  tools?: string;
  disallowedTools?: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  memory?: string;
  color?: string;
  isolation?: string;
  maxTurns?: string | number;
  target: Target;
}

const DESCRIPTION_MAX = 1024;
/** Claude Code cuts `description` plus `when_to_use` off at this length in its skill list. */
const LISTING_MAX = 1536;
const BODY_MAX_LINES = 500;
/** Reference files longer than this need a contents list, so a partial read still shows everything. */
const REFERENCE_TOC_LINES = 100;
const MIN_EVALS = 3;

/** Claude Code's built-in tools, plus older names that still work in tool lists. */
const CLAUDE_TOOLS = new Set([
  'Agent', 'AskUserQuestion', 'Bash', 'CronCreate', 'CronDelete', 'CronList', 'Edit', 'EnterPlanMode', 'EnterWorktree',
  'ExitPlanMode', 'ExitWorktree', 'Glob', 'Grep', 'LSP', 'ListMcpResourcesTool', 'Monitor', 'NotebookEdit', 'PowerShell',
  'Read', 'ReadMcpResourceTool', 'SendMessage', 'Skill', 'TaskCreate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop',
  'TaskUpdate', 'TodoWrite', 'ToolSearch', 'WebFetch', 'WebSearch', 'Write',
  'Task', 'MultiEdit', 'NotebookRead', 'BashOutput', 'KillShell', 'SlashCommand',
]);
const MODEL_ALIAS = /^(inherit|default|sonnet|opus|haiku|fable|opusplan)(\[1m\])?$/i;
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];
const PERMISSION_MODES = ['default', 'acceptEdits', 'auto', 'dontAsk', 'bypassPermissions', 'plan', 'manual'];
const MEMORY = ['user', 'project', 'local'];
const COLORS = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'];
const VAGUE_NAMES = ['helper', 'helpers', 'util', 'utils', 'utilities', 'tool', 'tools', 'document', 'documents', 'docs', 'data', 'files', 'misc', 'stuff', 'skill', 'agent'];

const XML_TAG = /<\/?[A-Za-z][^>]*>/;
const WHEN_CUE = /\b(when|whenever|proactively|after|before|if the user)\b|\buse (it |this )?for\b/i;
const FIRST_PERSON = /(^|[^\w'])(I|I'm|I'll|I've|We|we|we'll|we're)(?![\w'])/;
const SECOND_PERSON = /\b(you can|you could|you should|you'll|helps you|lets you|allows you)\b/i;
const VAGUE_DESCRIPTION = /^(helps? with|does stuff|processes data|handles? (files|data|documents))\b/i;
const WINDOWS_PATH = /(^|[\s`'"([])([A-Za-z]:\\)?([\w.-]+\\)+[\w.-]+\.\w+/m;
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
const DATED = new RegExp(`\\b(before|after|until|till|since|as of|starting|by)\\s+(?:${MONTH}\\.?\\s+)?(?:\\d{1,2},?\\s+)?(?:q[1-4]\\s+)?20\\d\\d\\b`, 'i');
const CONTENTS = /^(#{1,6}\s*(table of )?contents\b|\*\*(table of )?contents\*\*)/im;

const n = (x: number) => x.toLocaleString('en-US');

/** Tool lists may be comma- or space-separated; spaces inside `Bash(git add *)` belong to the tool. */
export function splitTools(s: string | undefined): string[] {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  for (const ch of s ?? '') {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && (ch === ',' || /\s/.test(ch))) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function unknownTools(s: string | undefined): string[] {
  return splitTools(s).filter((t) => {
    const name = t.replace(/\(.*\)$/s, '');
    return name !== '*' && !CLAUDE_TOOLS.has(name) && !/^mcp__[\w.-]+(__[\w.*-]+)?$/.test(name);
  });
}

/** Relative links in Markdown text, without anchors. */
function links(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\]\(<?([^)\s>]+)>?(?:\s+"[^"]*")?\)/g)) {
    const target = m[1].replace(/[#?].*$/, '').replace(/^\.\//, '');
    if (target && !/^([a-z][\w+.-]*:|\/|#)/i.test(m[1])) out.push(target);
  }
  return out;
}

const lineCount = (s: string) => s.replace(/\s+$/, '').split('\n').length;

function describe(out: LintIssue[], description: string | undefined, kind: 'agent' | 'skill', hasCue: boolean) {
  const d = (description ?? '').trim();
  if (!d) {
    out.push({ key: 'description', level: 'fix', text: `Add what it's for. The AI reads this to decide when to use this ${kind}.` });
    return;
  }
  if (XML_TAG.test(d)) {
    out.push({ key: 'description', level: 'fix', text: 'Remove the <tags>. Descriptions can’t contain XML tags.' });
  }
  if (!hasCue && !WHEN_CUE.test(d)) {
    out.push({
      key: 'description',
      level: 'tip',
      text: kind === 'agent'
        ? 'Say when to hand work to it, e.g. "Use after code changes." Claude reads this to decide when to delegate.'
        : 'Say when to use it, e.g. "Use when the user asks for release notes." The AI picks skills by this text.',
    });
  }
  if (FIRST_PERSON.test(d) || SECOND_PERSON.test(d)) {
    out.push({ key: 'description', level: 'tip', text: 'Describe what it does ("Writes release notes…"), not "I can…" or "You can…". It’s read as part of the AI’s instructions.' });
  }
  if (d.split(/\s+/).length < 5 || VAGUE_DESCRIPTION.test(d)) {
    out.push({ key: 'description', level: 'tip', text: 'Be more specific: say what it does and the words people use when they need it.' });
  }
}

function claudeModel(out: LintIssue[], model: string | undefined, effort: string | undefined) {
  if (model && !MODEL_ALIAS.test(model) && !/claude/i.test(model)) {
    out.push({ key: 'model', level: 'fix', text: `"${model}" isn't a Claude model. Use sonnet, opus, haiku, fable, inherit or a full model ID.` });
  }
  oneOf(out, 'effort', effort, EFFORTS);
}

function oneOf(out: LintIssue[], key: string, value: string | undefined, allowed: string[], label = key) {
  if (value && !allowed.includes(value)) {
    out.push({ key, level: 'fix', text: `"${value}" isn't a valid ${label}. Use ${allowed.join(', ')}.` });
  }
}

function tools(out: LintIssue[], key: string, value: string | undefined) {
  const unknown = unknownTools(value);
  if (unknown.length) {
    out.push({
      key,
      level: 'tip',
      text: `${unknown.join(', ')} ${unknown.length > 1 ? "aren't Claude Code tool names" : "isn't a Claude Code tool name"} Skill Canvas knows. Check the spelling; MCP tools look like mcp__server__tool.`,
    });
  }
}

export function lintSkill(s: SkillLint): LintIssue[] {
  const out: LintIssue[] = [];
  const claude = s.target === 'claude';
  const name = s.name.trim();

  if (name && (!/^[a-z0-9-]+$/.test(name) || name.length > 64)) {
    out.push({ key: 'name', level: 'fix', text: 'Names can only use lowercase letters, numbers and hyphens, up to 64 characters.' });
  }
  if (/claude|anthropic/i.test(name)) {
    out.push({ key: 'name', level: 'fix', text: 'Names can’t include "claude" or "anthropic".' });
  }
  if (VAGUE_NAMES.includes(name)) {
    out.push({ key: 'name', level: 'tip', text: `"${name}" is very general. A name like "writing-release-notes" says what it does.` });
  }
  if (s.folder && name && s.folder !== name) {
    out.push({ key: 'name', level: 'tip', text: `The name doesn't match its folder "${s.folder}". Keep them the same so every tool finds it under one name.` });
  }

  const d = (s.description ?? '').trim();
  const when = (s.whenToUse ?? '').trim();
  describe(out, d, 'skill', !!when);
  if (d.length > DESCRIPTION_MAX) {
    out.push({ key: 'description', level: 'fix', text: `It's ${n(d.length)} characters. Keep it under ${n(DESCRIPTION_MAX)} so it isn't cut off.` });
  } else if (claude && when && d.length + when.length > LISTING_MAX) {
    out.push({ key: 'when_to_use', level: 'fix', text: `With "What it's for", this is ${n(d.length + when.length)} characters. Claude Code cuts both off at ${n(LISTING_MAX)}.` });
  }

  const body = s.body ?? '';
  if (lineCount(body) > BODY_MAX_LINES) {
    out.push({ key: 'body', level: 'tip', text: `The instructions are over ${BODY_MAX_LINES} lines. Move detailed parts into extra files, so they're only read when needed.` });
  }
  if (WINDOWS_PATH.test(body)) {
    out.push({ key: 'body', level: 'tip', text: 'Use forward slashes in paths (scripts/run.py), so it works on every system.' });
  }
  if (DATED.test(body)) {
    out.push({ key: 'body', level: 'tip', text: 'It mentions a date, which will go out of date. Describe the current way, and put old ways under an "Old patterns" heading.' });
  }
  if (s.files) {
    const known = new Set([...s.files, ...(s.references ?? []).map((r) => r.path)]);
    for (const link of [...new Set(links(body))].filter((l) => !known.has(l))) {
      out.push({ key: 'body', level: 'tip', text: `Links to ${link}, which isn't in this skill's folder.` });
    }
  }

  for (const r of s.references ?? []) {
    if (lineCount(r.content) > REFERENCE_TOC_LINES && !CONTENTS.test(r.content)) {
      out.push({ key: 'references', level: 'tip', text: `${r.path} is over ${REFERENCE_TOC_LINES} lines. Start it with a short "Contents" list, so the AI sees everything it covers.` });
    }
    const deeper = links(r.content).filter((l) => /\.md$/i.test(l));
    if (deeper.length) {
      out.push({ key: 'references', level: 'tip', text: `${r.path} links to ${deeper.join(', ')}. Link every extra file from the main instructions instead; the AI may only skim files it finds through other files.` });
    }
  }

  if (s.evalCount !== undefined && s.evalCount < MIN_EVALS) {
    const more = MIN_EVALS - s.evalCount;
    out.push({ key: 'evals', level: 'tip', text: `Add ${more} more test scenario${more > 1 ? 's' : ''}. At least ${MIN_EVALS} help you check the skill does what you expect.` });
  }

  if (claude) {
    tools(out, 'allowed-tools', s.tools);
    claudeModel(out, s.model, s.effort);
  }
  return out;
}

export function lintAgent(a: AgentLint): LintIssue[] {
  const out: LintIssue[] = [];
  const name = a.name.trim();
  if (!name || name.startsWith('-') || name.includes(':')) {
    out.push({ key: 'name', level: 'fix', text: 'Add a name that doesn’t start with a hyphen or contain a colon.' });
  }
  describe(out, a.description, 'agent', false);
  if (a.target === 'claude') {
    tools(out, 'tools', a.tools);
    if (splitTools(a.tools).some((t) => /^Agent\(.+\)$/s.test(t))) {
      out.push({
        key: 'tools',
        level: 'tip',
        text: 'Agent(…) only limits which agents it can start when it runs as the main session (claude --agent). As a subagent it can start any agent; name the ones to use in its instructions.',
      });
    }
    tools(out, 'disallowedTools', a.disallowedTools);
    claudeModel(out, a.model, a.effort);
    oneOf(out, 'permissionMode', a.permissionMode, PERMISSION_MODES, 'permission mode');
    oneOf(out, 'memory', a.memory, MEMORY, 'memory scope');
    oneOf(out, 'color', a.color, COLORS);
    oneOf(out, 'isolation', a.isolation, ['worktree']);
    if (a.maxTurns !== undefined && !/^[1-9]\d*$/.test(String(a.maxTurns))) {
      out.push({ key: 'maxTurns', level: 'fix', text: 'Max turns must be a whole number above 0.' });
    }
  }
  return out;
}
