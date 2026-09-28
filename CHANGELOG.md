# Changelog

All notable changes to Skill Canvas are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.0.1]

### Added

- Custom editor for `*.skillcanvas` files: a node-graph canvas backed by JSON, so undo/redo, save and source control work as usual.
- Blocks for **Input**, **Output**, **Agent**, **Skill** and **Tool**, plus **If** (yes/no) and **Loop** (repeat/done) for branches and repetition. Add them from the palette, by click, or from a starter on an empty canvas.
- Two kinds of connection: arrows for step order, and dotted **uses** links from an Agent to the Skills and Tools it can use without them becoming steps.
- Canvas navigation: pan, zoom, fit, keyboard moves, rename with F2 or double-click, Tab through every block, and connect blocks from the details panel without a mouse.
- Top bar with the workflow name, its `/command`, an **Export for** switch (Claude Code or GitHub Copilot), a "to fix" list that jumps to the field needing attention, and **Export**.
- Details panel with plain-language fields and an **Advanced** section, plus a rendered **Preview** or editable text of the generated file; edits to an agent or skill file flow back into its fields.
- **Export** to Claude Code (`.claude/agents`, `.claude/skills`) or GitHub Copilot (`.github/agents`, `.github/skills`), at project or user scope. It lists every file as new, updated or replacing something, offers to remove files from a previous export that are no longer on the canvas, and creates a workflow skill with numbered steps (including branches and loops) once two or more steps are connected.

[Unreleased]: https://github.com/alaturqua/skill-canvas/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/alaturqua/skill-canvas/releases/tag/v0.0.1
