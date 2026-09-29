# Changelog
<!-- markdownlint-configure-file { "MD024": { "siblings_only": true } } -->

All notable changes to Skill Canvas are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Import agents & skills**: bring existing agents and skills onto the canvas from `.claude` and `.github` in the project, or from `~/.claude` and `~/.copilot`. Use **Import agents & skills** in the palette, the link on an empty canvas, the title-bar button, or **Skill Canvas: Import Agents & Skills**. Skills an agent preloads become **uses** links. Files that would export back to the same path are remembered, so editing them on the canvas and exporting updates them in place.
- **Arrange** left to right or top to bottom, from the canvas toolbar. It lays the workflow out in steps, puts skills and tools next to the agent that uses them, and moves the connection points to match the direction.
- Step numbers on the blocks, matching the numbered steps in the generated workflow file.

### Changed

- Connections back to an earlier step, such as a loop, now route around the blocks in between instead of through them.
- A branch's label (yes/no, repeat/done) shows on the block until that branch is connected, then on the connection, so it appears once.
- In the export list, files that already exist but weren't written by this canvas start unchecked. If you check one, the original goes to the trash before it's replaced.
- **Ready** and **Export** only appear when there is something to export.

### Fixed

- A canvas file that isn't valid JSON, for example after a merge conflict, no longer opens as an empty canvas that the next edit would overwrite. The editor now says what's wrong, offers **Open as text**, and saves nothing until the file is fixed.
- Export errors are shown in the canvas and in an error message instead of failing silently. Files written before the error are still tracked.
- In the workflow file, an Input's "The user provides" note now ends with a full stop.

## [0.1.3] - 2026-09-29

### Added

- Extension icon for the Marketplace and the Extensions view.

## [0.1.2] - 2026-09-29

### Changed

- Release pipeline: publishing to Open VSX is now opt-in. It needs the `PUBLISH_OPEN_VSX` repository variable set to `true` as well as the `OVSX_PAT` secret.

## [0.1.1] - 2026-09-29

First public release. Version 0.1.0 was prepared but not published.

### Added

- Custom editor for `*.skillcanvas` files: a node-graph canvas backed by JSON, so undo/redo, save and source control work as usual.
- Blocks for **Input**, **Output**, **Agent**, **Skill** and **Tool**, plus **If** (yes/no) and **Loop** (repeat/done) for branches and repetition. Add them from the palette, by click, or from a starter on an empty canvas.
- Two kinds of connection: arrows for step order, and dotted **uses** links from an Agent to the Skills and Tools it can use without them becoming steps.
- Canvas navigation: pan, zoom, fit, keyboard moves, rename with F2 or double-click, Tab through every block, and connect blocks from the details panel without a mouse.
- Top bar with the workflow name, its `/command`, an **Export for** switch (Claude Code or GitHub Copilot), a "to fix" list that jumps to the field needing attention, and **Export**.
- Details panel with plain-language fields and an **Advanced** section, plus a rendered **Preview** or editable text of the generated file. Edits to an agent or skill file flow back into its fields.
- **Export** to Claude Code (`.claude/agents`, `.claude/skills`) or GitHub Copilot (`.github/agents`, `.github/skills`), at project or user scope. It lists every file as new, updated or replacing something, offers to remove files from a previous export that are no longer on the canvas, and creates a workflow skill with numbered steps (including branches and loops) once two or more steps are connected.

### Changed

- Licensed under the Apache License 2.0.

[Unreleased]: https://github.com/alaturqua/skill-canvas/compare/v0.1.3...HEAD
[0.1.3]: https://github.com/alaturqua/skill-canvas/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/alaturqua/skill-canvas/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/alaturqua/skill-canvas/releases/tag/v0.1.1
