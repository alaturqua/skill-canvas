# Skill Canvas

Visual canvas for building agent and skill workflows, inside VS Code.

## Features

- `*.skillcanvas` files open in a node-graph editor (custom text editor, JSON-backed). Edits write straight to the file, so undo/redo, save and source control work as usual.
- Blocks: **Input**, **Agent**, **Skill**, **Tool**, **Output**, plus logic blocks **If** (`true`/`false`) and **Loop** (`body`/`done`; connect back into the loop for the next iteration). Drag from the palette or click to add.
- Side panel: select a block to fill in its details (description, model, tools, system prompt or instructions, condition, max iterations) and see the generated file live. With nothing selected it shows the workflow settings.
- **Skill Canvas: Export Agents & Skills** (title bar button, or **Export…** in the panel) writes for the target chosen under **Export for**, to the project or your user folder:

  | Target | Agents | Skills | Workflow |
  | --- | --- | --- | --- |
  | Claude Code | `.claude/agents/<name>.md` | `.claude/skills/<name>/SKILL.md` | `.claude/skills/<workflow>/SKILL.md` |
  | GitHub Copilot | `.github/agents/<name>.agent.md` | `.github/skills/<name>/SKILL.md` | `.github/skills/<workflow>/SKILL.md` |

  User scope uses `~/.claude/` or `~/.copilot/`. The workflow skill turns the graph into numbered steps, including branches and loops. Existing files are only overwritten after confirmation.

## Develop

```sh
npm install
npm run compile
```

Then run **Tasks: Run Task → Dev: launch host (no debugger)**. It compiles and opens a separate VS Code instance (own profile in `.vscode-test/`) on `sandbox/example.skillcanvas`.

- Webview changes (`media/`): **Developer: Reload Webviews** in the dev host.
- Extension changes (`src/`): `npm run compile` (or keep `npm run watch` running), then **Developer: Reload Window**.
- Logs: **Output → Skill Canvas** in the dev host, also written to `.vscode-test/user-data/logs/**/Skill Canvas.log`. Webview JS errors are forwarded there.

F5 (**Run Extension**) also works where the debugger can attach to the extension host.

## Layout

- `src/extension.ts` – activation and the New Canvas command
- `src/canvasEditor.ts` – custom editor provider, syncs webview and document
- `src/model.ts` – canvas data model (`nodes`, `edges`)
- `media/canvas.js`, `media/canvas.css` – webview UI (vanilla SVG, no build step)

## Before publishing

Create the `alaturqua` publisher at <https://marketplace.visualstudio.com/manage> (the ID can't be changed later), and check npm and domain availability for `skill-canvas`.
