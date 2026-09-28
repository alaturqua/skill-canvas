# Skill Canvas

Visual canvas for building agent and skill workflows, inside VS Code.

## Features

- `*.skillcanvas` files open in a node-graph editor (custom text editor, JSON-backed). Edits write straight to the file, so undo/redo, save and source control work as usual.
- Blocks: **Input**, **Output**, **Agent**, **Skill**, **Tool**, plus **If** (yes/no) and **Loop** (repeat/done; connect back into the loop for the next round). Drag from the palette, click to add, or pick a starter on an empty canvas.
- Two kinds of connection: arrows are step order; a dotted **uses** link from the handle under an Agent to a Skill or Tool means the agent can use it (preloaded skill, allowed tool) without it becoming a step.
- Canvas: pan (drag the background, scroll, or Space+drag), zoom (Ctrl+scroll, +/−, Fit), select and delete connections, move blocks with the arrow keys, rename with F2 or a double-click. Every block is reachable with Tab, and the details panel can connect blocks without a mouse.
- Top bar: workflow name, its `/command` (click to copy), **Export for** Claude Code or GitHub Copilot, a "to fix" list that jumps to the field that needs attention, and **Export**.
- Details panel: plain-language fields for the selected block, with an **Advanced** section for model and tool details. Below it, the generated file as a rendered **Preview** or as text to **Edit**; edits to an agent or skill file flow back into its fields.
- **Export** (also **Skill Canvas: Export Agents & Skills** and the title-bar button) asks for the project or your user folder, lists every file as new, updated or replacing something, offers to remove files from a previous export that are no longer on the canvas, and ends with the command to run:

  | Target | Agents | Skills | Workflow |
  | --- | --- | --- | --- |
  | Claude Code | `.claude/agents/<name>.md` | `.claude/skills/<name>/SKILL.md` | `.claude/skills/<workflow>/SKILL.md` |
  | GitHub Copilot | `.github/agents/<name>.agent.md` | `.github/skills/<name>/SKILL.md` | `.github/skills/<workflow>/SKILL.md` |

  User scope uses `~/.claude/` or `~/.copilot/`. The workflow skill, created once two or more steps are connected, turns the graph into numbered steps including branches and loops. The canvas file records what it last exported (relative paths only).

## Develop

```sh
npm install
npm run compile
```

Then run **Tasks: Run Task → Dev: launch host (no debugger)**. It compiles and opens a separate VS Code instance (own profile in `.vscode-test/`) on `sandbox/loop-example.skillcanvas`, a small bug-fixing workflow with a loop, a branch and a linked skill.

- Webview changes (`media/`): **Developer: Reload Webviews** in the dev host.
- Extension changes (`src/`): `npm run compile` (or keep `npm run watch` running), then **Developer: Reload Window**.
- Logs: **Output → Skill Canvas** in the dev host, also written to `.vscode-test/user-data/logs/**/Skill Canvas.log`. Webview JS errors are forwarded there.

F5 (**Run Extension**) also works where the debugger can attach to the extension host.

## Layout

- `src/extension.ts` – activation, New Canvas, and the export flow
- `src/canvasEditor.ts` – custom editor provider: webview markup and icons, document sync, analysis for the panel
- `src/export.ts` – canvas → agent/skill/workflow files, warnings, and reading edited files back
- `src/model.ts` – canvas data model (`nodes`, `edges`, `lastExport`)
- `media/canvas.js`, `media/canvas.css` – webview UI (vanilla SVG, no build step)
- `PRODUCT.md` – who the product is for and its principles

## Before publishing

Create the `alaturqua` publisher at <https://marketplace.visualstudio.com/manage> (the ID can't be changed later), and check npm and domain availability for `skill-canvas`.
