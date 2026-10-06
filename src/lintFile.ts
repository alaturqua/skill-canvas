import { parseFile } from './export';
import { Level, lintAgent, lintSkill } from './lint';
import type { Target } from './model';

/** A check result placed on a line of the file, from 0. */
export interface FileIssue {
  line: number;
  text: string;
  level: Level;
}

/** What's in a skill's folder besides SKILL.md, when the caller has read it. */
export interface SkillFolder {
  files: string[];
  references?: { path: string; content: string }[];
  evalCount?: number;
}

export type FileKind = { kind: 'skill'; target: Target; folder: string } | { kind: 'agent'; target: Target };

/** Whether a path is a skill or agent file, and for which tool. Undefined for anything else. */
export function fileKind(path: string): FileKind | undefined {
  const p = path.replace(/\\/g, '/');
  const copilot = /\/\.(github|copilot)\//.test(p);
  const skill = /(?:^|\/)skills\/([^/]+)\/SKILL\.md$/.exec(p);
  if (skill) {
    return { kind: 'skill', target: copilot ? 'copilot' : 'claude', folder: skill[1] };
  }
  if (/\/\.claude\/agents\/(?:.+\/)?[^/]+\.md$/.test(p)) {
    return { kind: 'agent', target: 'claude' };
  }
  if (/\/\.(github|copilot)\/agents\/[^/]+\.agent\.md$/.test(p)) {
    return { kind: 'agent', target: 'copilot' };
  }
  return undefined;
}

/** The best-practice checks for an agent or skill file, by line. Undefined if it is neither. */
export function lintFile(path: string, text: string, folder?: SkillFolder): FileIssue[] | undefined {
  const what = fileKind(path);
  if (!what) {
    return undefined;
  }
  const { fields, body, raw, bodyLine } = parseFile(text);
  const str = (k: string) => {
    const v = fields[k];
    return Array.isArray(v) ? v.join(', ') : v;
  };
  // Claude Code reads agent files without a name as documentation.
  if (what.kind === 'agent' && !str('name')) {
    return [];
  }
  const lineOf = (key: string) => (key === 'body' ? bodyLine : raw.find((b) => b.key === key)?.line ?? 0);
  const issues =
    what.kind === 'skill'
      ? lintSkill({
          name: str('name') ?? what.folder,
          description: str('description'),
          whenToUse: str('when_to_use'),
          body,
          tools: str('allowed-tools'),
          model: str('model'),
          effort: str('effort'),
          target: what.target,
          folder: what.folder,
          references: folder?.references,
          files: folder?.files,
          evalCount: folder?.evalCount,
        })
      : lintAgent({
          name: str('name') ?? '',
          description: str('description'),
          tools: str('tools'),
          disallowedTools: str('disallowedTools'),
          model: str('model'),
          effort: str('effort'),
          permissionMode: str('permissionMode'),
          memory: str('memory'),
          color: str('color'),
          isolation: str('isolation'),
          maxTurns: str('maxTurns'),
          target: what.target,
        });
  return issues.map((i) => ({ line: lineOf(i.key), text: i.text, level: i.level }));
}
