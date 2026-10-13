import { Target } from './model';

/** A GitHub repository, optionally narrowed to a branch and a folder. */
export interface RepoRef {
  owner: string;
  repo: string;
  ref?: string;
  dir?: string;
}

/**
 * Reads `owner/repo`, or a github.com link to a repository or a folder in it.
 * shortcut: in `/tree/<branch>/<folder>` links, the branch is the first segment; branch names with a slash need the plain form.
 */
export function parseRepo(input: string): RepoRef | undefined {
  const s = input.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const m =
    /^(?:https?:\/\/)?(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+)(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?$/i.exec(s) ??
    /^([\w.-]+)\/([\w.-]+)$/.exec(s);
  if (!m) {
    return undefined;
  }
  const [, owner, repo, ref, dir] = m;
  return { owner, repo, ref: ref || undefined, dir: dir ? decodeURIComponent(dir).replace(/\/SKILL\.md$/i, '') : undefined };
}

/** An agent or skill found in a repository's file list. */
export interface RemoteEntry {
  /** Path in the repository, e.g. `plugins/review/agents/reviewer.md`. */
  repoPath: string;
  /** Path as an import sees it, relative to its agents/ or skills/ folder's parent. */
  path: string;
  kind: 'agent' | 'skill';
  target: Target;
  /** The folder holding agents/ and skills/, e.g. `plugins/review`, or '' at the top. */
  group: string;
  /** Skills: other files in its folder, relative to it, with their size. */
  extras: { path: string; size?: number }[];
}

const AGENT = /^(.*?)(?:^|\/)agents\/([^/]+\.md)$/i;
const SKILL = /^(.*?)(?:^|\/)skills\/([^/]+)\/SKILL\.md$/;

/** Agents (`agents/*.md`) and skills (`skills/<name>/SKILL.md`) anywhere in a repository's files. */
export function findInTree(files: { path: string; size?: number }[], dir?: string): RemoteEntry[] {
  const inDir = (p: string) => !dir || p === dir || p.startsWith(`${dir}/`);
  const out: RemoteEntry[] = [];
  for (const f of files) {
    if (!inDir(f.path) || /(^|\/)node_modules\//.test(f.path) || /(^|\/)README\.md$/i.test(f.path)) {
      continue;
    }
    const a = AGENT.exec(f.path);
    // An agents/ folder inside a skill's folder holds that skill's own prompts.
    if (a && !/(^|\/)skills\/[^/]+(\/|$)/.test(a[1])) {
      const copilot = /\.agent\.md$/i.test(a[2]);
      out.push({ repoPath: f.path, path: `agents/${a[2]}`, kind: 'agent', target: copilot ? 'copilot' : 'claude', group: a[1], extras: [] });
      continue;
    }
    const s = SKILL.exec(f.path);
    if (s) {
      const folder = f.path.slice(0, -'SKILL.md'.length);
      const extras = files
        .filter((x) => x.path.startsWith(folder) && x.path !== f.path)
        .map((x) => ({ path: x.path.slice(folder.length), size: x.size }));
      // Skills under .github are Copilot's; everywhere else they are read as Claude Code skills.
      const target: Target = /(^|\/)\.github$/.test(s[1]) ? 'copilot' : 'claude';
      out.push({ repoPath: f.path, path: `skills/${s[2]}/SKILL.md`, kind: 'skill', target, group: s[1], extras });
    }
  }
  // One group after another, so each shows once in the list.
  return out.sort((x, y) => (x.group < y.group ? -1 : x.group > y.group ? 1 : 0));
}

/** Plugins a marketplace.json lists from other repositories, as `owner/repo`. */
export function otherRepos(marketplaceJson: string, self: RepoRef): string[] {
  let plugins: unknown;
  try {
    plugins = JSON.parse(marketplaceJson).plugins;
  } catch {
    return [];
  }
  if (!Array.isArray(plugins)) {
    return [];
  }
  const here = `${self.owner}/${self.repo}`.toLowerCase();
  const repos = plugins
    .map((p: any) => (p?.source?.source === 'github' && typeof p.source.repo === 'string' ? p.source.repo : undefined))
    .filter((r): r is string => !!r && r.toLowerCase() !== here);
  return [...new Set(repos)];
}
