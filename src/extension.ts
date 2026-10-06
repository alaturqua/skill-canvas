import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { CanvasEditorProvider } from './canvasEditor';
import { registerDiagnostics } from './diagnostics';
import { buildExport, foldersToTidy, ROOTS } from './export';
import { emptyModel, readModel, Scope } from './model';

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Skill Canvas', { log: true });
  log.info('Activated');
  const provider = new CanvasEditorProvider(context, log);
  context.subscriptions.push(
    log,
    vscode.window.registerCustomEditorProvider(
      CanvasEditorProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    ),
    vscode.commands.registerCommand('skillCanvas.new', async () => {
      const folder = vscode.workspace.workspaceFolders?.[0];
      if (!folder) {
        vscode.window.showErrorMessage('Open a folder first to create a Skill Canvas.');
        return;
      }
      const name = await vscode.window.showInputBox({
        prompt: 'Canvas name',
        value: 'workflow',
        validateInput: (v) => (/^[\w.-]+$/.test(v) ? undefined : 'Use letters, numbers, - _ . only'),
      });
      if (!name) {
        return;
      }
      const uri = vscode.Uri.joinPath(folder.uri, `${name}.skillcanvas`);
      try {
        await vscode.workspace.fs.stat(uri);
      } catch {
        await vscode.workspace.fs.writeFile(
          uri,
          Buffer.from(JSON.stringify(emptyModel(), null, 2), 'utf8')
        );
      }
      await vscode.commands.executeCommand('vscode.openWith', uri, CanvasEditorProvider.viewType);
    }),
    vscode.commands.registerCommand('skillCanvas.export', (uri?: vscode.Uri) => exportCanvas(log, uri)),
    vscode.commands.registerCommand('skillCanvas.import', (uri?: vscode.Uri) => provider.importInto(uri ?? activeCanvasUri()))
  );
  registerDiagnostics(context, log);
}

function activeCanvasUri(): vscode.Uri | undefined {
  const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
  return input instanceof vscode.TabInputCustom && input.viewType === CanvasEditorProvider.viewType
    ? input.uri
    : undefined;
}

/** What an export did, for the canvas to show. */
export interface ExportSummary {
  command?: string;
  written: number;
  removed: number;
  label: string;
  /** Set when the export stopped part-way. */
  error?: string;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function exists(uri: vscode.Uri) {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

/**
 * After files were removed from a skill's folder, removes the folders they leave empty,
 * deepest first. A folder that still has something in it stays.
 */
export async function removeEmptyFolders(root: vscode.Uri, removed: string[]) {
  const folders = [...new Set(removed.flatMap((p) => foldersToTidy(p)))].sort((a, b) => b.split('/').length - a.split('/').length);
  for (const f of folders) {
    const dir = vscode.Uri.joinPath(root, ...f.split('/'));
    const left = await vscode.workspace.fs.readDirectory(dir).then((d) => d.length, () => -1);
    // Empty, so nothing goes to the trash; not recursive, so a file added meanwhile stops it.
    if (left === 0) {
      await vscode.workspace.fs.delete(dir, { recursive: false, useTrash: false });
    }
  }
}

async function exportCanvas(log: vscode.LogOutputChannel, uri = activeCanvasUri()): Promise<ExportSummary | undefined> {
  if (!uri) {
    vscode.window.showErrorMessage('Open a Skill Canvas first, then export it.');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  const { model, error: unreadable } = readModel(doc.getText());
  if (unreadable) {
    const open = 'Open as text';
    const answer = await vscode.window.showErrorMessage(
      `Can't export ${path.basename(uri.fsPath)}: the file isn't valid canvas JSON (${unreadable}). Fix it first.`,
      open
    );
    if (answer === open) {
      await vscode.commands.executeCommand('vscode.openWith', uri, 'default');
    }
    return;
  }
  const target = model.target ?? 'claude';
  const { files, warnings, command } = buildExport(model, path.basename(uri.fsPath, '.skillcanvas'), target);
  if (!files.length) {
    vscode.window.showInformationMessage('Nothing to export yet. Add an Agent or Skill block first.');
    return;
  }

  // 1. Where: the project or the user's folder, last used first.
  const roots = ROOTS[target];
  const folder = vscode.workspace.getWorkspaceFolder(uri) ?? vscode.workspace.workspaceFolders?.[0];
  const last = model.lastExport?.target === target ? model.lastExport : undefined;
  const choices: (vscode.QuickPickItem & { root: vscode.Uri; scope: Scope })[] = [];
  if (folder) {
    const root = vscode.Uri.joinPath(folder.uri, roots.project);
    choices.push({ label: 'This project', description: root.fsPath, detail: 'Only in this project. Can be committed and shared with your team.', root, scope: 'project' });
  }
  const home = vscode.Uri.file(path.join(os.homedir(), roots.user));
  choices.push({ label: 'All my projects', description: home.fsPath, detail: 'Saved in your user folder, available everywhere.', root: home, scope: 'user' });
  if (last) {
    choices.sort((a, b) => Number(b.scope === last.scope) - Number(a.scope === last.scope));
    choices[0].label += '  (last used)';
  }
  const where = await vscode.window.showQuickPick(choices, {
    title: `Export to ${roots.label}`,
    placeHolder: 'Where should the agents and skills be saved?',
  });
  if (!where) {
    return;
  }

  // 2. What: every file, marked new, updated or replacing something, plus leftovers to remove.
  // A file this canvas didn't write stays unchecked; if checked, the original goes to the trash.
  const previous = new Set(last?.scope === where.scope ? last.files : []);
  type Item = vscode.QuickPickItem & { write?: (typeof files)[number]; remove?: string; foreign?: boolean };
  const items: Item[] = [];
  for (const f of files) {
    const known = previous.has(f.path);
    const found = await exists(vscode.Uri.joinPath(where.root, ...f.path.split('/')));
    const foreign = found && !known;
    items.push({
      label: `${foreign ? '$(warning)' : '$(file)'} ${f.path}`,
      description: !found
        ? 'new'
        : known
          ? 'updates your last export'
          : 'already exists and wasn’t made by this canvas. Check to replace it; the old file goes to the trash',
      picked: !foreign,
      write: f,
      foreign,
    });
  }
  for (const p of previous) {
    if (!files.some((f) => f.path === p) && (await exists(vscode.Uri.joinPath(where.root, ...p.split('/'))))) {
      items.push({ label: `$(trash) Remove ${p}`, description: 'from your last export, no longer on the canvas', picked: true, remove: p });
    }
  }
  const toFix = warnings.filter((w) => w.level !== 'tip').length;
  const tips = warnings.length - toFix;
  const todo = toFix
    ? `${plural(toFix, 'thing', 'things')} still to fix on the canvas. Press Enter to export anyway, or Escape to go back.`
    : tips
      ? `Everything checked will be saved. Press Enter to export (${plural(tips, 'tip', 'tips')} on the canvas can make it better).`
      : 'Everything checked will be saved. Press Enter to export.';
  const chosen = await vscode.window.showQuickPick(items, {
    canPickMany: true,
    ignoreFocusOut: true,
    title: `Export ${plural(files.length, 'file', 'files')} to ${where.root.fsPath}`,
    placeHolder: todo,
  });
  if (!chosen) {
    return;
  }
  if (!chosen.length) {
    vscode.window.showInformationMessage('Nothing was checked, so nothing was exported.');
    return;
  }

  // 3. Write and remove. A failure stops the export, but what was done is still recorded.
  const written: string[] = [];
  const removed: string[] = [];
  let failure: string | undefined;
  try {
    for (const item of chosen) {
      if (item.write) {
        const file = vscode.Uri.joinPath(where.root, ...item.write.path.split('/'));
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(file, '..'));
        if (item.foreign) {
          await vscode.workspace.fs.delete(file, { useTrash: true });
          log.info(`Moved the existing file to the trash: ${file.fsPath}`);
        }
        await vscode.workspace.fs.writeFile(file, Buffer.from(item.write.content, 'utf8'));
        log.info(`Wrote ${file.fsPath}`);
        written.push(item.write.path);
      } else if (item.remove) {
        const file = vscode.Uri.joinPath(where.root, ...item.remove.split('/'));
        await vscode.workspace.fs.delete(file, { useTrash: true });
        log.info(`Moved to trash: ${file.fsPath}`);
        removed.push(item.remove);
      }
    }
    await removeEmptyFolders(where.root, removed);
  } catch (e) {
    failure = e instanceof Error ? e.message : String(e);
    log.error(`Export stopped: ${failure}`);
  }
  const names = new Map(model.nodes.map((n) => [n.id, n.name]));
  for (const w of warnings) {
    const text = w.nodeId ? `${names.get(w.nodeId)}: ${w.text}` : w.text;
    if (w.level === 'tip') {
      log.info(`Tip: ${text}`);
    } else {
      log.warn(text);
    }
  }

  // 4. Remember what this canvas owns there, so the next export can update or clean it up.
  // Leftovers you chose to keep stay on the list, so they're offered for removal again.
  if (written.length || removed.length) {
    const owned = [...new Set([...previous, ...written])].filter((p) => !removed.includes(p));
    const current = readModel(doc.getText());
    if (!current.error) {
      current.model.lastExport = { target, scope: where.scope, files: owned };
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), JSON.stringify(current.model, null, 2));
      await vscode.workspace.applyEdit(edit);
      await doc.save();
    }
  }

  if (failure) {
    const showLog = 'Show log';
    void vscode.window
      .showErrorMessage(`Export stopped: ${failure}. ${written.length} of ${chosen.filter((c) => c.write).length} files were saved.`, showLog)
      .then((action) => action === showLog && log.show());
    return { command, written: written.length, removed: removed.length, label: roots.label, error: failure };
  }

  // 5. Say what to do next.
  const done = removed.length
    ? `Saved ${plural(written.length, 'file', 'files')}, removed ${removed.length}.`
    : `Saved ${plural(written.length, 'file', 'files')}.`;
  const next = command ? ` Run ${command} in ${roots.label} to start the workflow.` : ` ${roots.label} can use them now.`;
  const copy = command ? `Copy ${command}` : undefined;
  // Not awaited: the canvas should show the result without waiting for this message to close.
  const first = chosen.find((c) => c.write)?.write;
  void vscode.window.showInformationMessage(done + next, ...(copy ? [copy] : []), 'Show in folder').then((action) => {
    if (action === copy && command) {
      vscode.env.clipboard.writeText(command);
    } else if (action === 'Show in folder' && first) {
      vscode.commands.executeCommand('revealFileInOS', vscode.Uri.joinPath(where.root, ...first.path.split('/')));
    }
  });
  return { command, written: written.length, removed: removed.length, label: roots.label };
}

export function deactivate() {}
