# Skill Canvas

**Sketch how the work should flow. Skill Canvas writes the agent and skill files that Claude Code and GitHub Copilot run.**

Draw the workflow with blocks and arrows, answer a few plain questions for each step, and export. No YAML, no folder rules to learn.

[Try it in your browser](https://alaturqua.github.io/skill-canvas/#try) · [Website](https://alaturqua.github.io/skill-canvas/) · [Report an issue](https://github.com/alaturqua/skill-canvas/issues)

![Starting from a starter, filling in an agent and its skill, switching to GitHub Copilot, and arranging the blocks top to bottom](docs/images/hero.gif)

## Why Skill Canvas

- **See the whole workflow.** Steps, decisions and retries sit on one board, numbered in the order they run.
- **Real files, not a new format.** You get standard agent and skill files in the places Claude Code and GitHub Copilot look for them. They keep working without Skill Canvas installed.
- **One sketch, two tools.** Switch between Claude Code and GitHub Copilot at any time. The same board prints both.
- **Bring what you have.** Import the agents and skills you already wrote, edit them on the board, and export them back to the same files.

## Quick start

### 1. Create a canvas

Open a folder in VS Code. Then click **New Canvas** in the **Skill Canvas** view in the activity bar, or run **Skill Canvas: New Canvas** from the Command Palette (`Ctrl+Shift+P`, or `Cmd+Shift+P` on a Mac). Give it a name and it opens as `<name>.skillcanvas` in the folder.

Pick a starter to begin with a small working flow, or close the card and drag blocks in from the left.

![A new canvas: the blocks on the left and three starters: Single agent, Agent with a skill, and Try until it works](docs/images/starters.png)

### 2. Sketch with blocks

| Block      | Use it for                                                         |
| ---------- | ------------------------------------------------------------------ |
| **Input**  | What the workflow starts with, like a bug report or a question     |
| **Output** | What the workflow delivers, like a pull request or an answer       |
| **Agent**  | An AI assistant with its own instructions                          |
| **Skill**  | Reusable instructions, like a playbook or a checklist              |
| **Tool**   | A specific tool, like the terminal                                 |
| **If**     | Take one of two paths, like "tests pass" or "tests fail"           |
| **Loop**   | Repeat steps a set number of times, like "up to 3 tries"           |

### 3. Fill in each block

Select a block and the details panel on the right asks plain questions: what it's for, its instructions, and which tools it may use. Further down, the panel previews the exact file the block becomes. For an agent or a skill, switch to **Edit file** to change the Markdown yourself; your edits go back into the form.

The toolbar counts anything still missing, like an agent without instructions. When nothing is missing it says **Ready**.

![An agent selected on the board, with its name, what it's for, instructions and tools in the details panel](docs/images/fill.png)

### 4. Connect the steps

- **Order:** drag from the dot on a block's outgoing edge to the next block. You can also pick the **Next step** in the details panel.
- **Decisions and retries:** an **If** block has a *yes* and a *no* path. A **Loop** has *repeat* and *done*.
- **Skills and tools:** drag from the small handle under an agent to a Skill or Tool block. The dotted **uses** link gives that agent the skill.
- **Tidy up:** the **Arrange** buttons at the bottom right lay the board out left to right or top to bottom. The step numbers follow along.

![A bug-fix workflow: Bug report, Up to 3 tries, Fix & test, Tests pass?, then Pull request or back to try again, with a Write PR notes skill linked to the agent](docs/images/connect.png)

### 5. Export

Choose **Claude Code** or **GitHub Copilot** in the toolbar and click **Export**. Skill Canvas asks where to save:

- **This project**: in the workspace, so you can commit the files and share them with your team.
- **All my projects**: in your user folder, so they're available everywhere.

Before anything is written, you see every file and whether it's new or an update. Files this canvas wrote last time are updated in place. A file that exists but wasn't written by this canvas starts unchecked. If you check it, the original goes to the trash before it's replaced.

![The workflow's settings: when to run it, its /loop-example command, and the three files it will create](docs/images/export.png)

### 6. Run it

Type the workflow's command in Claude Code or GitHub Copilot Chat, for example `/loop-example`. The command is shown at the top of the canvas; click it to copy it. The workflow hands each step to the agents you drew.

## Import the agents and skills you already have

Click **Import agents & skills** at the bottom of the block list, or run **Skill Canvas: Import Agents & Skills**. Pick from `.claude` or `.github` in your project, or from your user folder (`~/.claude`, `~/.copilot`). Skills an agent already loads arrive linked to it. Edit them on the board, export, and the same files update in place.

![An imported Code reviewer agent linked to its Code standards skill, with the skill's file previewed in the details panel](docs/images/import.png)

## Where the files go

Standard locations, so the tools find them without Skill Canvas installed.

| For                          | Agents                               | Skills and workflows                 |
| ---------------------------- | ------------------------------------ | ------------------------------------ |
| Claude Code, this project    | `.claude/agents/<name>.md`           | `.claude/skills/<name>/SKILL.md`     |
| Claude Code, all projects    | `~/.claude/agents/<name>.md`         | `~/.claude/skills/<name>/SKILL.md`   |
| GitHub Copilot, this project | `.github/agents/<name>.agent.md`     | `.github/skills/<name>/SKILL.md`     |
| GitHub Copilot, all projects | `~/.copilot/agents/<name>.agent.md`  | `~/.copilot/skills/<name>/SKILL.md`  |

## Keyboard shortcuts

| Key               | Does                                                   |
| ----------------- | ------------------------------------------------------ |
| `Delete`          | Remove the selected block or connection                |
| `F2`              | Rename the selected block                              |
| Arrow keys        | Move the selected block (`Shift` for bigger steps)     |
| `+` and `-`       | Zoom in and out                                        |
| `0`               | Fit everything on screen                               |
| `Space` + drag    | Move around the canvas                                 |
| `Escape`          | Clear the selection, or close the starters             |

## Good to know

- **Your canvas is a file.** A `.skillcanvas` file is plain JSON. Commit it next to the files it makes, so your team can open and change the workflow too.
- **Nothing leaves your machine.** Skill Canvas only reads and writes files in your workspace and user folder.
- **It follows your theme**, including high contrast themes.
- **Requirements:** VS Code 1.90 or later. To run what you export, you need Claude Code or GitHub Copilot.

## Contributing

Bug reports and ideas are welcome in [GitHub issues](https://github.com/alaturqua/skill-canvas/issues). To build and test the extension yourself, see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE). Skill Canvas is not affiliated with Anthropic or GitHub.
