import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { parseFile, ROOTS, slug } from './export';
import { FoundFile, fileName, humanize, importFiles, ImportResult, WORKFLOW_MARKER } from './importer';
import { CanvasModel, Scope, Target } from './model';

interface Location {
  target: Target;
  scope: Scope;
  root: vscode.Uri;
  label: string;
}

type Found = FoundFile & { location: Location };

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

/** Agents (`agents/*.md`, or `*.agent.md` for Copilot) and skills (`skills/<name>/SKILL.md`). */
async function scan(folder: vscode.WorkspaceFolder | undefined): Promise<Found[]> {
  const found: Found[] = [];
  for (const location of locations(folder)) {
    const agentFile = location.target === 'claude' ? /\.md$/i : /\.agent\.md$/i;
    for (const [name, type] of await readDir(vscode.Uri.joinPath(location.root, 'agents'))) {
      if (type !== vscode.FileType.File || !agentFile.test(name)) {
        continue;
      }
      const text = await readText(vscode.Uri.joinPath(location.root, 'agents', name));
      if (text !== undefined) {
        found.push({ path: `agents/${name}`, text, kind: 'agent', target: location.target, scope: location.scope, location });
      }
    }
    for (const [name, type] of await readDir(vscode.Uri.joinPath(location.root, 'skills'))) {
      if (type !== vscode.FileType.Directory || name.startsWith('.')) {
        continue;
      }
      const text = await readText(vscode.Uri.joinPath(location.root, 'skills', name, 'SKILL.md'));
      if (text !== undefined) {
        found.push({ path: `skills/${name}/SKILL.md`, text, kind: 'skill', target: location.target, scope: location.scope, location });
      }
    }
  }
  return found;
}

const shorten = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);

/** Lets the user pick agents and skills to bring onto the canvas. */
export async function pickImports(
  folder: vscode.WorkspaceFolder | undefined,
  model: CanvasModel
): Promise<(ImportResult & { targets: Target[] }) | undefined> {
  const found = await scan(folder);
  if (!found.length) {
    vscode.window.showInformationMessage(
      'No agents or skills found. Skill Canvas looks in .claude and .github in this project, and in ~/.claude and ~/.copilot.'
    );
    return;
  }

  const onCanvas = new Set(
    model.nodes.filter((n) => n.kind === 'agent' || n.kind === 'skill').map((n) => `${n.kind}:${slug(n.name)}`)
  );
  type Item = vscode.QuickPickItem & { file?: Found };
  const items: Item[] = [];
  let group = '';
  for (const f of found) {
    if (f.location.label !== group) {
      group = f.location.label;
      items.push({ label: group, kind: vscode.QuickPickItemKind.Separator });
    }
    const name = fileName(f);
    const { fields, body } = parseFile(f.text);
    const already = onCanvas.has(`${f.kind}:${slug(name)}`);
    // Workflow skills Skill Canvas wrote itself would come back as one plain skill.
    const generated = f.kind === 'skill' && body.includes(WORKFLOW_MARKER);
    const description = Array.isArray(fields.description) ? fields.description.join(', ') : fields.description;
    items.push({
      label: `${f.kind === 'agent' ? '$(account)' : '$(book)'} ${humanize(name)}`,
      description: [f.kind, already && 'already on the canvas', generated && 'a workflow made by Skill Canvas'].filter(Boolean).join(' · '),
      detail: shorten(description?.trim() || 'No description', 110),
      picked: !already && !generated,
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
  const files = (chosen ?? []).map((i) => i.file).filter((f): f is Found => !!f);
  if (!files.length) {
    return;
  }
  const result = importFiles(files, model.nodes, () => Math.random().toString(36).slice(2, 9));
  return { ...result, targets: files.map((f) => f.target) };
}
