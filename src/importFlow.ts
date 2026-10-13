import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseFile, ROOTS, slug } from './export';
import { FoundFile, fileName, humanize, importFiles, ImportResult, WORKFLOW_MARKER } from './importer';
import { findInTree, otherRepos, parseRepo, RemoteEntry } from './importRemote';
import { CanvasModel, Scope, Target } from './model';

interface Location {
  target: Target;
  scope: Scope;
  root: vscode.Uri;
  label: string;
  /** Set for an installed Claude Code plugin: its agents and skills are linked, not copied. */
  plugin?: string;
}

type Found = FoundFile & { location: Location; dir?: vscode.Uri };

/** Where agents and skills live: the project first, then the user's folders. */
function locations(folder: vscode.WorkspaceFolder | undefined): Location[] {
  const targets: Target[] = ['claude', 'copilot'];
  const out: Location[] = [];
  if (folder) {
    for (const target of targets) {
      out.push({ target, scope: 'project', root: vscode.Uri.joinPath(folder.uri, ROOTS[target].project), label: `This project · ${ROOTS[target].label}` });
    }
  }
  for (const target of targets) {
    out.push({ target, scope: 'user', root: vscode.Uri.file(path.join(os.homedir(), ROOTS[target].user)), label: `All my projects · ${ROOTS[target].label}` });
  }
  return out;
}

async function readDir(uri: vscode.Uri) {
  try {
    return await vscode.workspace.fs.readDirectory(uri);
  } catch {
    return [];
  }
}

async function readText(uri: vscode.Uri) {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/**
 * Plugins installed in Claude Code, from its list in ~/.claude/plugins.
 * shortcut: reads the default agents/ and skills/ folders only, not custom paths in plugin.json; upgrade if plugins use them.
 */
async function pluginLocations(): Promise<Location[]> {
  const list = await readText(vscode.Uri.file(path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json')));
  let plugins: Record<string, { installPath?: unknown }[]> = {};
  try {
    plugins = JSON.parse(list ?? '{}').plugins ?? {};
  } catch {
    return [];
  }
  const out: Location[] = [];
  for (const [key, installs] of Object.entries(plugins)) {
    const plugin = key.split('@')[0];
    const at = Array.isArray(installs) ? installs.find((i) => typeof i?.installPath === 'string')?.installPath : undefined;
    if (plugin && typeof at === 'string' && !out.some((l) => l.plugin === plugin)) {
      out.push({ target: 'claude', scope: 'user', root: vscode.Uri.file(at), label: `Installed plugin · ${plugin} (linked, not copied)`, plugin });
    }
  }
  return out;
}

/** Limits for reading a skill's folder: how deep, how many files, and how big a Markdown file to read. */
const FOLDER_DEPTH = 3;
const FOLDER_FILES = 200;
const TEXT_BYTES = 256 * 1024;

/** The files in a skill's folder besides SKILL.md, with the text of Markdown files and test scenarios. */
export async function skillFolder(dir: vscode.Uri): Promise<{ path: string; text?: string }[]> {
  const out: { path: string; text?: string }[] = [];
  const walk = async (rel: string, depth: number) => {
    for (const [name, type] of await readDir(rel ? vscode.Uri.joinPath(dir, ...rel.split('/')) : dir)) {
      const path = rel ? `${rel}/${name}` : name;
      if (out.length >= FOLDER_FILES || name.startsWith('.') || name === 'node_modules' || name === '__pycache__') {
        continue;
      }
      if (type === vscode.FileType.Directory && depth < FOLDER_DEPTH) {
        await walk(path, depth + 1);
      } else if (type === vscode.FileType.File && path !== 'SKILL.md') {
        const uri = vscode.Uri.joinPath(dir, ...path.split('/'));
        const readable = /\.md$/i.test(name) || path === 'evals/evals.json';
        const small = readable && (await vscode.workspace.fs.stat(uri).then((s) => s.size <= TEXT_BYTES, () => false));
        out.push({ path, text: small ? await readText(uri) : undefined });
      }
    }
  };
  await walk('', 1);
  return out;
}

/** Agents (`agents/*.md`, or `*.agent.md` for Copilot) and skills (`skills/<name>/SKILL.md`). */
async function scan(folder: vscode.WorkspaceFolder | undefined): Promise<Found[]> {
  const found: Found[] = [];
  for (const location of [...locations(folder), ...(await pluginLocations())]) {
    const agentFile = location.target === 'claude' ? /\.md$/i : /\.agent\.md$/i;
    for (const [name, type] of await readDir(vscode.Uri.joinPath(location.root, 'agents'))) {
      if (type !== vscode.FileType.File || !agentFile.test(name)) {
        continue;
      }
      const text = await readText(vscode.Uri.joinPath(location.root, 'agents', name));
      if (text !== undefined) {
        found.push({ path: `agents/${name}`, text, kind: 'agent', target: location.target, scope: location.scope, location, plugin: location.plugin });
      }
    }
    for (const [name, type] of await readDir(vscode.Uri.joinPath(location.root, 'skills'))) {
      if (type !== vscode.FileType.Directory || name.startsWith('.')) {
        continue;
      }
      const dir = vscode.Uri.joinPath(location.root, 'skills', name);
      const text = await readText(vscode.Uri.joinPath(dir, 'SKILL.md'));
      if (text !== undefined) {
        found.push({ path: `skills/${name}/SKILL.md`, text, kind: 'skill', target: location.target, scope: location.scope, location, dir, plugin: location.plugin });
      }
    }
  }
  return found;
}

const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** How many agents and skills one download may list, so a huge repository doesn't mean hundreds of requests. */
const REMOTE_MAX = 150;

/** GitHub's API, signed in only if VS Code already has a GitHub session: more requests and private repositories, no prompt. */
async function github(url: string, accept = 'application/vnd.github+json'): Promise<Response> {
  const headers: Record<string, string> = { Accept: accept, 'User-Agent': 'skill-canvas' };
  const session = await vscode.authentication.getSession('github', ['repo'], { silent: true }).then((s) => s, () => undefined);
  if (session) {
    headers.Authorization = `Bearer ${session.accessToken}`;
  }
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const limited = res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0';
    throw new Error(
      limited ? 'GitHub allows only a few requests an hour without signing in. Sign in to GitHub in VS Code, or try again later.'
      : res.status === 404 ? 'Not found. Check the name, or sign in to GitHub in VS Code for a private repository.'
      : `GitHub answered ${res.status} ${res.statusText}.`
    );
  }
  return res;
}

/** Agents and skills from a GitHub repository or marketplace, copied onto the canvas as text. */
async function pickFromGitHub(): Promise<FoundFile[] | undefined> {
  const input = await vscode.window.showInputBox({
    title: 'Import from GitHub',
    prompt: 'A repository or marketplace, like anthropics/skills, or a link to a folder in one.',
    placeHolder: 'owner/repo or https://github.com/owner/repo/tree/main/skills',
    validateInput: (v) => (parseRepo(v) ? undefined : 'Enter owner/repo, or a github.com link.'),
  });
  const ref = input && parseRepo(input);
  if (!ref) {
    return;
  }
  const api = `https://api.github.com/repos/${ref.owner}/${ref.repo}`;
  const repoName = `${ref.owner}/${ref.repo}`;

  type Picked = vscode.QuickPickItem & { entry?: RemoteEntry; text?: string };
  let items: Picked[] = [];
  let sha = '';
  let license = '';
  let others: string[] = [];
  let cut = false;
  try {
    await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `Looking in ${repoName}…` }, async () => {
      const info = (await (await github(api)).json()) as { default_branch: string; license?: { spdx_id?: string } | null };
      license = info.license?.spdx_id && info.license.spdx_id !== 'NOASSERTION' ? info.license.spdx_id : '';
      sha = (await (await github(`${api}/commits/${encodeURIComponent(ref.ref ?? info.default_branch)}`, 'application/vnd.github.sha')).text()).trim();
      const tree = (await (await github(`${api}/git/trees/${sha}?recursive=1`)).json()) as { tree: { path: string; type: string; size?: number }[]; truncated?: boolean };
      const blobs = tree.tree.filter((t) => t.type === 'blob');
      let found = findInTree(blobs, ref.dir);
      cut = !!tree.truncated || found.length > REMOTE_MAX;
      found = found.slice(0, REMOTE_MAX);
      const raw = (p: string) => fetch(`https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${sha}/${p.split('/').map(encodeURIComponent).join('/')}`).then((r) => (r.ok ? r.text() : undefined), () => undefined);
      const market = blobs.find((b) => b.path === '.claude-plugin/marketplace.json');
      others = market ? otherRepos((await raw(market.path)) ?? '', ref) : [];
      const texts = await Promise.all(found.map((e) => raw(e.repoPath)));
      let group: string | undefined;
      for (const [i, e] of found.entries()) {
        const text = texts[i];
        if (text === undefined) {
          continue;
        }
        if (e.group !== group) {
          group = e.group;
          items.push({ label: group || repoName, kind: vscode.QuickPickItemKind.Separator });
        }
        const { fields } = parseFile(text);
        const description = Array.isArray(fields.description) ? fields.description.join(', ') : fields.description;
        const name = fileName({ path: e.path, text, kind: e.kind });
        items.push({
          label: `${e.kind === 'agent' ? '$(account)' : '$(book)'} ${humanize(name)}`,
          description: [e.kind, e.target === 'copilot' && 'GitHub Copilot'].filter(Boolean).join(' · '),
          detail: shorten(description?.trim() || 'No description', 110),
          entry: e,
          text,
        });
      }
    });
  } catch (e) {
    vscode.window.showErrorMessage(`Couldn't read ${repoName}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  if (!items.some((i) => i.entry)) {
    vscode.window.showInformationMessage(
      `No agents or skills found in ${repoName}${ref.dir ? `/${ref.dir}` : ''}.` + (others.length ? ` Its marketplace lists plugins from ${others.join(', ')}: import from those.` : '')
    );
    return;
  }
  const short = sha.slice(0, 7);
  const chosen = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
    title: `Import from ${repoName} · ${license ? `${license} license` : 'no license given'}`,
    placeHolder: 'Pick what to copy onto the canvas, then press Enter. Read it on the board before you export.',
  });
  const picked = (chosen ?? []).filter((i) => i.entry && i.text !== undefined);
  if (!picked.length) {
    return;
  }

  // Only Markdown and test scenarios come along; scripts and other files are named, not downloaded.
  const skipped: string[] = [];
  const files: FoundFile[] = [];
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Downloading…' }, async () => {
    for (const { entry: e, text } of picked) {
      const folder = e!.repoPath.slice(0, -'SKILL.md'.length);
      const extras: { path: string; text?: string }[] = [];
      for (const x of e!.extras) {
        const readable = (/\.md$/i.test(x.path) || x.path === 'evals/evals.json') && (x.size ?? 0) <= TEXT_BYTES;
        if (!readable) {
          skipped.push(`${folder}${x.path}`);
          continue;
        }
        const url = `https://raw.githubusercontent.com/${ref.owner}/${ref.repo}/${sha}/${(folder + x.path).split('/').map(encodeURIComponent).join('/')}`;
        const t = await fetch(url).then((r) => (r.ok ? r.text() : undefined), () => undefined);
        if (t !== undefined) {
          extras.push({ path: x.path, text: t });
        } else {
          skipped.push(`${folder}${x.path}`);
        }
      }
      files.push({ path: e!.path, text: text!, kind: e!.kind, target: e!.target, scope: 'project', extras, source: `${repoName}@${short}:${e!.repoPath}` });
    }
  });
  const notes = [
    cut && `Only the first ${REMOTE_MAX} were listed; use a link to a folder to see the rest.`,
    skipped.length && `Not downloaded: ${shorten(skipped.join(', '), 300)}. Get them from ${repoName} if a skill needs them.`,
    others.length && `This marketplace also lists plugins from ${others.join(', ')}.`,
  ].filter(Boolean);
  if (notes.length) {
    vscode.window.showInformationMessage(notes.join(' '));
  }
  return files;
}

/** Lets the user pick agents and skills to bring onto the canvas. */
export async function pickImports(
  folder: vscode.WorkspaceFolder | undefined,
  model: CanvasModel
): Promise<(ImportResult & { targets: Target[] }) | undefined> {
  const found = await scan(folder);

  const onCanvas = new Set(
    model.nodes.filter((n) => n.kind === 'agent' || n.kind === 'skill').map((n) => n.plugin ? `${n.kind}:${n.plugin}:${n.name}` : `${n.kind}:${slug(n.name)}`)
  );
  type Item = vscode.QuickPickItem & { file?: Found; remote?: boolean };
  const items: Item[] = [{
    label: '$(github) From a GitHub repository or marketplace…',
    detail: found.length ? 'Pick this too, and you choose from the repository next.' : 'Nothing found in .claude, .github, ~/.claude, ~/.copilot or installed plugins.',
    alwaysShow: true,
    remote: true,
  }];
  let group = '';
  for (const f of found) {
    if (f.location.label !== group) {
      group = f.location.label;
      items.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
    }
    const name = fileName(f);
    const { fields, body } = parseFile(f.text);
    const already = onCanvas.has(f.plugin ? `${f.kind}:${f.plugin}:${name}` : `${f.kind}:${slug(name)}`);
    // Workflow skills Skill Canvas wrote itself would come back as one plain skill.
    const generated = f.kind === 'skill' && body.includes(WORKFLOW_MARKER);
    const description = Array.isArray(fields.description) ? fields.description.join(', ') : fields.description;
    items.push({
      label: `${f.kind === 'agent' ? '$(account)' : '$(book)'} ${f.plugin ? `${f.plugin}:${name}` : humanize(name)}`,
      description: [f.kind, already && 'already on the canvas', generated && 'a workflow made by Skill Canvas'].filter(Boolean).join(' · '),
      detail: shorten(description?.trim() || 'No description', 110),
      // Plugins bring many blocks, so only what's picked from them comes along.
      picked: !already && !generated && !f.plugin,
      file: f,
    });
  }

  const chosen = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    matchOnDescription: true,
    matchOnDetail: true,
    title: 'Import agents and skills',
    placeHolder: 'Pick what to bring onto the canvas, then press Enter.',
  });
  const local = (chosen ?? []).map((i) => i.file).filter((f): f is Found => !!f);
  // Only the chosen skills' folders are read.
  for (const f of local) {
    if (f.dir && !f.plugin) {
      f.extras = await skillFolder(f.dir);
    }
  }
  const files: FoundFile[] = [...local, ...((chosen ?? []).some((i) => i.remote) ? (await pickFromGitHub()) ?? [] : [])];
  if (!files.length) {
    return;
  }
  const result = importFiles(files, model.nodes, () => Math.random().toString(36).slice(2, 9));
  return { ...result, targets: files.map((f) => f.target) };
}
