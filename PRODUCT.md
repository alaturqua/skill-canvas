# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

Skill Canvas is a VS Code extension. Its UI is a webview (HTML/CSS/JS) inside the editor, not a website.

## Users

Primary: less technical builders, such as product managers, prompt engineers and analysts, who can describe how an AI workflow should behave but should not have to hand-write Markdown, YAML frontmatter or folder conventions. They work in VS Code, alongside Claude Code or GitHub Copilot, and want agents and skills they can actually use there.

Developers who already write agent and skill files are a secondary audience, not the design target.

## Product Purpose

Skill Canvas lets people build agent and skill workflows visually on a canvas, then saves them as real, standard agent and skill files that Claude Code and GitHub Copilot load natively. Success means someone who has never written a SKILL.md produces a working agent, skill or multi-step workflow without leaving the canvas or learning the file formats.

## Positioning

- **Workflows are first-class.** Branches (If) and loops (Loop) are designed visually, then compiled into plain agent and skill files. There is no runtime or lock-in; the output works without Skill Canvas installed.
- **Tool-agnostic export.** One canvas exports to both Claude Code and GitHub Copilot, with more targets possible later.
- **Round-trip editing (committed, not built yet).** Import existing agents and skills from `.claude/` or `.github/` onto the canvas and edit them visually.

Running or debugging workflows inside VS Code is not a committed direction.

## Operating Context

- The user opens a `*.skillcanvas` file in VS Code. It is JSON, lives in the repo, and works with save, undo and source control.
- They drag blocks from a palette (Input, Agent, Skill, Tool, Output, If, Loop), connect them, and fill in each block's details in a side panel that shows the generated file live.
- Export writes to the project (`.claude/` or `.github/`) or the user's global folder (`~/.claude/` or `~/.copilot/`). The workflow as a whole becomes an orchestrating skill that can be run as `/workflow-name`.
- The same VS Code window usually has Claude Code or Copilot open, so users move between the canvas and chat.

## Capabilities and Constraints

- Output must follow the official file formats: Claude Code subagents (`agents/<name>.md`) and skills (`skills/<name>/SKILL.md`), and GitHub Copilot custom agents (`agents/<name>.agent.md`) and skills. Names are lowercase with hyphens.
- The UI must follow the active VS Code theme (light, dark and high-contrast) through VS Code theme tokens, and sit comfortably inside the editor chrome.
- Terminology users see: Agent, Skill, Tool, Input, Output, If, Loop, Workflow, Export. File-format jargon (frontmatter, YAML) should stay out of the user's way.
- Distribution: free to start, with paid features or a pro tier planned later.
- Undecided: pricing, which features become paid, and when round-trip editing ships.

## Brand Commitments

- Name: Skill Canvas. Marketplace ID `alaturqua.skill-canvas`, publisher `alaturqua`, repository `github.com/alaturqua/skill-canvas`.
- Existing icon: `media/icon.svg`, a two-node-and-connector glyph that uses `currentColor`.

## Evidence on Hand

None yet: no users, testimonials, metrics or case studies. Future work must not invent any. Example workflows exist in `sandbox/` for development only.

## Product Principles

1. **No file formats required.** A user who never opens the generated Markdown should still get correct, working agents and skills.
2. **Real files, no lock-in.** Everything compiles to standard files the target tools load natively. The canvas is the editor, not the runtime.
3. **Show the result.** Every block shows what it will produce, so users trust the export before running it.
4. **One design, many tools.** Target-specific differences are handled in the export, not pushed onto the user.
5. **Feel native to VS Code.** Respect the editor's themes, conventions and keyboard habits instead of fighting them.
