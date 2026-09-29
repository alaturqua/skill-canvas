---
name: Skill Canvas site
description: The public GitHub Pages site for the Skill Canvas VS Code extension, built as a workshop whiteboard.
colors:
  board: "#f3f5f8"
  board-line: "#dfe3ea"
  frame: "#a7d8f5"
  frame-edge: "#7db7dd"
  on-frame-2: "#2a3340"
  ink: "#1c1e24"
  ink-2: "#464b55"
  blue: "#1d4ed8"
  red: "#c42b21"
  green: "#12733a"
  green-deep: "#0d5a2d"
  canary: "#ffe14d"
  coral: "#ff9478"
  mint: "#97e2bd"
  sky: "#96cdfa"
  paper: "#ffffff"
  tape: "#16171b"
  magnet-red: "#d7342a"
  magnet-blue: "#2356d6"
  magnet-black: "#2a2c33"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(2.5rem, 1rem + 4.1vw, 4.9rem)"
    fontWeight: 850
    lineHeight: 0.97
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 125"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(2rem, 1.2rem + 2.6vw, 3.4rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 118"
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "clamp(1.4rem, 1.1rem + 0.8vw, 1.8rem)"
    fontWeight: 800
    lineHeight: 1.02
    letterSpacing: "-0.02em"
    fontVariation: "'wdth' 118"
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "1.0625rem"
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: "normal"
  label:
    fontFamily: "Archivo, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 750
    lineHeight: 1.25
    letterSpacing: "0.09em"
    fontVariation: "'wdth' 112"
  hand:
    fontFamily: "Kalam, 'Segoe Print', 'Bradley Hand', cursive"
    fontSize: "1.1rem"
    fontWeight: 700
    lineHeight: 1.3
  mono:
    fontFamily: "ui-monospace, 'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "12.5px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  tape: "2px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  lg: "10px"
  full: "50%"
spacing:
  gutter: "clamp(16px, 4vw, 56px)"
  section: "clamp(64px, 9vw, 128px)"
  max: "1240px"
  section-head-gap: "clamp(26px, 3.4vw, 44px)"
components:
  button-install:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.md}"
    padding: "14px 22px"
  button-install-hover:
    backgroundColor: "{colors.green-deep}"
  button-line:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "12px 18px"
  button-line-hover:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.board}"
  button-copy:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "4px 11px"
  rail:
    backgroundColor: "{colors.frame}"
    textColor: "{colors.ink}"
    padding: "10px clamp(16px, 4vw, 56px)"
  rail-install:
    backgroundColor: "{colors.green}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  sticky-note:
    backgroundColor: "{colors.canary}"
    textColor: "{colors.ink}"
    padding: "22px 26px 24px"
  printout-sheet:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.mono}"
  label-tape:
    backgroundColor: "{colors.tape}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.tape}"
    padding: "6px 10px"
  step-number:
    backgroundColor: "{colors.board}"
    textColor: "{colors.blue}"
    rounded: "{rounded.full}"
    size: "46px"
  magnet:
    backgroundColor: "{colors.magnet-red}"
    rounded: "{rounded.full}"
    size: "22px"
  tray:
    backgroundColor: "{colors.frame}"
    textColor: "{colors.ink}"
---

# Design System: Skill Canvas site

## Overview

**Creative North Star: "The Workshop Whiteboard"**

The site is the team's whiteboard after a good working session: a cool porcelain enamel board with faint erased-marker ghosting, a process sketched in sticky notes and hand-drawn marker arrows, and the real agent and skill files it produces magneted beside it as printouts. Everything on the page is an object you would find at that board: sticky notes, dry-erase inks, round magnets, printed sheets wearing embossed label tape, a baby-blue rail across the top and a matching marker tray at the bottom. Nothing is a floating card or a glowing screenshot.

Density is relaxed and physical. Objects sit at slight rotations (roughly -2.4deg to +2.4deg) and cast soft offset shadows, so the board reads as a surface with things stuck to it. Colour is carried by the sticky-note palette at page scale: whole fields of canary, coral and sky run to the page edges, while dry-erase inks keep strict semantic roles. Type is loud and heavy where it sells (expanded, 800-850 weight Archivo) and hand-lettered only where someone annotated the board (Kalam).

Scope boundary: this system covers the public GitHub Pages site (`site/`, built to `_site/`). The extension's own editor webview (`media/canvas.css`, `media/canvas.js`) is an Operate surface that follows VS Code theme tokens (`--vscode-*`, emulated for the demo by `site/demo/theme.css` as VS Code Light Modern). It appears on the site only as the embedded live demo inside a neutral screen frame, and it is not governed by this document. Do not restyle the webview with these tokens, and do not bring `--vscode-*` values into the site.

**Key Characteristics:**
- Cool porcelain board (never pure white) with an erased-marker ghost texture, framed by a baby-blue rail and tray with ink text.
- Dry-erase inks as roles: black for text, blue for connections and focus, red for corrections and annotations, green for done, export and install.
- Sticky-note colours as flat saturated fields, from a single note up to full-bleed page sections.
- Paper printouts held by flat solid-disc magnets, each wearing one black label tape strip (kind, name, file path).
- Heavy expanded Archivo for the offer and UI, Kalam marker hand for annotations only, monospace only inside printouts and code.
- Soft offset lift shadows and slight rotations; marker strokes draw on once, notes settle once.

## Colors

A cool, bright whiteboard palette: porcelain and baby blue as the frame, four dry-erase inks with fixed jobs, and four sticky-note brights used as flat fields.

### Primary
- **Marker Green** (green): The done and export ink. Fills every install action (hero button, rail button) with white text, and draws the "yes" branch in the sketch. Hover deepens to **Deep Marker Green** (green-deep).

### Secondary
- **Connection Blue** (blue): The connection ink. Links, the focus ring, sketch arrows, the vertical step path, circled step numbers and dotted "uses" lines.
- **Correction Red** (red): The correction ink. Kalam annotations ("no, retry", the export note), retry arrows. Never used for buttons or fills.

### Tertiary
- **Canary** (canary): The default sticky note, text selection, and the full-bleed closing install field.
- **Coral** (coral): Sticky notes and the Claude Code edition field under the live board.
- **Mint** (mint): Sticky notes only.
- **Sky** (sky): Sticky notes and the Copilot edition field under the live board.
- **Magnet Red / Magnet Blue / Magnet Black** (magnet-red, magnet-blue, magnet-black): Flat solid discs that pin printouts, cards and the demo screen. Kept separate from the inks so a magnet never reads as an annotation.

### Neutral
- **Porcelain Board** (board): The page surface under everything, and the fill inside circled step numbers so the blue path passes behind them.
- **Board Line** (board-line): Hairline borders on inline code chips on the board.
- **Baby Blue Frame** (frame): The sticky top rail and the footer marker tray, with a 1px **Frame Edge** (frame-edge) line toward the board. Text on it is ink; fine print uses **Frame Ink** (on-frame-2).
- **Board Ink** (ink): All primary text, outline-button strokes, step illustrations.
- **Faded Ink** (ink-2): Ledes, section-head supporting text, table headers, secondary copy.
- **Printout Paper** (paper): Printed sheets, the file-locations card, the export dialog.
- **Label Tape** (tape): The embossed label strip on every printout, with white text and a canary name.

### Named Rules
**The Ink Roles Rule.** Each dry-erase ink has one job. Blue connects and focuses, red corrects and annotates, green means done, export or install, black writes. A new element picks its ink by meaning, never for variety.

**The Flat Field Rule.** Sticky-note colours are flat and saturated: no gradients, tints or transparency on the note itself. At page scale they become full-bleed fields (canary close, coral and sky editions) that run to the page edges.

**The Frame Rule.** The baby-blue frame appears exactly twice, as the top rail and the bottom tray, with ink text and no side strips.

## Typography

**Display Font:** Archivo variable (weight 100-900, width 62-125%), with ui-sans-serif, system-ui, Segoe UI fallback
**Body Font:** Archivo at normal width
**Annotation Font:** Kalam 400/700, with Segoe Print, Bradley Hand, cursive
**Mono Font:** ui-monospace, Cascadia Mono, SF Mono, Menlo, Consolas

**Character:** A heavy, expanded grotesque that sounds like a confident workshop lead, answered by a quick marker hand that sounds like someone scribbling on the board beside it.

### Hierarchy
- **Display** (850, clamp(2.5rem to 4.9rem), 0.97, width 125%): The hero headline and the closing install headline only.
- **Headline** (800, clamp(2rem to 3.4rem), 1.02, width 118%): Section titles.
- **Title** (800, clamp(1.25rem to 1.8rem), 1.02, width 118-122%): Step-note titles and edition headings.
- **Body** (400, 1.0625rem, 1.6): Running copy; section-head and lede text at 1.125-1.25rem in Faded Ink, capped near 34em.
- **Label** (700-750, 11-12px, 0.07-0.09em, uppercase, width 112%): Label tape on printouts, the block-kind line on sticky notes (Input, Agent, If, Output), and table column headers.
- **Hand** (700, 1.1rem to ~1.8rem): Kalam annotations, sticky-note main words, circled step numbers.
- **Mono** (400, 12.5-13px, 1.5): Contents of printouts, inline code, export file lists.

### Named Rules
**The Marker Hand Rule.** Kalam appears only where a person would write on the board: annotations, sticky-note words, circled numbers. Never for headings, buttons, body copy or navigation.

**The Printout Mono Rule.** Monospace lives only inside printouts, code chips and file lists. It is never a display or label face.

## Layout

Content sits in a 1240px maximum measure with a fluid gutter of clamp(16px, 4vw, 56px); section padding is computed so wide screens centre the content while full-bleed fields still reach the viewport edges. Sections are separated by a vertical rhythm of clamp(64px, 9vw, 128px), and section heads cap at 46rem with clamp(26px, 3.4vw, 44px) below them.

The hero is an asymmetric two-column grid (1.12fr copy to 1fr sketch). The sketch is a container-query drawing, 100 units wide by 112 tall, with every note, stroke and sheet placed in container units so the whole composition scales as one object. The live board sits in a white screen frame pinned by two magnets and tucks into the two edition fields below it (coral left, sky right), which bleed to their page edges. The five-step path is a single vertical column with a 4px blue line threading circled numbers, a sticky note and a line drawing per step.

Responsive behaviour: at 980px the hero and import grids stack and the edition fields stack full width; at 820px the rail anchors hide; at 760px the live iframe is replaced by a static board image; at 640px step art hides, the file table becomes labelled stacked rows, and buttons go full width.

## Elevation & Depth

Depth is physical and ambient: objects are stuck to a board, so they lift slightly off it with soft offset shadows that fall downward. There are no glows, no coloured shadows and no hard offset blocks. The board itself gets a soft inset shadow under the rail so the rail reads as sitting in front of it.

### Shadow Vocabulary
- **Lift** (`box-shadow: 0 1px 1px rgb(28 30 36 / 0.08), 0 14px 24px -14px rgb(28 30 36 / 0.5)`): Sticky notes, printout sheets, the file card, the demo screen.
- **Lift Low** (`box-shadow: 0 1px 1px rgb(28 30 36 / 0.06), 0 8px 14px -8px rgb(28 30 36 / 0.42)`): The primary install button.
- **Magnet** (`box-shadow: 0 3px 5px -2px rgb(28 30 36 / 0.45)`): Under each magnet disc.
- **Rail Inset** (`box-shadow: inset 0 3px 8px -4px rgb(28 30 36 / 0.25)`): Top edge of the board under the sticky rail.
- **Dialog** (`box-shadow: 0 28px 56px -24px rgb(0 0 0 / 0.5)`): The export dialog only.

### Named Rules
**The Stuck-On Rule.** Anything that lives on the board (note, sheet, card, screen) takes Lift and a small rotation. Frame and field surfaces (rail, tray, edition fields, close) are flat.

## Shapes

Board objects are square-cornered: sticky notes, printouts and the file card have no radius, because paper and notes do not have rounded corners. Rounding belongs to things that are manufactured: buttons at 8px, small controls at 6px, the demo screen and dialog at 10px, code chips and the focus ring at 4px, label tape at a near-square 2px. Magnets, step numbers and sticky-note numbers are perfect circles. Hand-drawn strokes use round caps and joins.

## Components

### Buttons
Solid, physical and direct, like the one green marker that means "go".
- **Shape:** Gently rounded (8px).
- **Primary (Install):** Marker Green fill, white text, 750 weight at width 112%, 14px 22px padding, a download line icon, Lift Low shadow.
- **Hover / Focus:** Deepens to Deep Marker Green; presses down 1px on active; 150ms ease-out. Focus is a 3px Connection Blue ring offset 3px.
- **Outline (Marketplace):** 2px ink stroke, transparent fill, 650 weight; hover inverts to ink fill with porcelain text.
- **Copy:** Small 1.5px Faded Ink outline at 6px radius; turns Marker Green once copied.

### Sticky Notes
The page's main colour carrier and the unit of every sketch.
- **Style:** Flat canary, coral, mint or sky fill; square corners; Lift shadow; rotated slightly.
- **Content:** An uppercase Label line naming the block kind, then the main word in Kalam. In step notes, an Archivo title and body text in ink at 88% opacity.
- **Number:** An optional circled blue number in Kalam hangs off the top-left corner.

### Printouts and Label Tape
- **Sheet:** Printout Paper, square corners, Lift, slight rotation, mono contents.
- **Tape:** One black label strip per sheet: kind in white, name in canary, file path in pale grey mono.
- **Magnet:** A 22px flat solid disc (red, blue or black) overlapping the top edge.

### Navigation
- **Rail:** Sticky baby-blue bar with the icon and wordmark, three to four in-page anchors (600 weight, underline on hover), a GitHub link and a small green Install button (6px radius). Anchors collapse under 820px, the GitHub link under 640px.
- **Tray:** Baby-blue footer with a row of four drawn markers (black, blue, red, green), project links in ink and fine print in Frame Ink.

### Live Board Screen (signature)
The real editor runs in a white 10px-radius screen with a neutral grey title bar, pinned by two black magnets. Its two editions (Claude Code on coral, Copilot on sky) print directly beneath it as full-bleed fields and reprint with a short 420ms drop as you edit. The neutral greys in the screen frame deliberately match VS Code chrome, not this palette.

### Circled Step Path
A single vertical 4px blue line connects 46px circled numbers (3px blue ring, porcelain fill, Kalam numeral), each beside a rotated sticky note and a 2.5px ink line drawing.

## Do's and Don'ts

### Do:
- **Do** keep the page on Porcelain Board (#f3f5f8) and reserve Printout Paper white for sheets, cards, the screen and dialogs.
- **Do** pick an ink by meaning: blue for connections and focus, red for annotations, green for install, export and done.
- **Do** lay sticky-note colours as flat fields, up to full-bleed sections, with square corners, slight rotation and the Lift shadow.
- **Do** give every printout exactly one black label tape strip and hold it with a flat solid-disc magnet.
- **Do** set headlines in Archivo 800-850 at expanded width (118-125%) and keep Kalam to annotations, note words and circled numbers.
- **Do** draw marker strokes on once and let notes settle once, and render both static under reduced motion.

### Don't:
- **Don't** use a dark hero, a glowing editor screenshot, or a grid of feature cards.
- **Don't** use glow, neon, or coloured shadows; depth is the soft downward Lift only.
- **Don't** add side strips or extra frame bands; the baby-blue frame is the rail and the tray only.
- **Don't** render magnets as glossy or gradient spheres; they are flat solid discs.
- **Don't** round sticky notes or printouts.
- **Don't** apply these tokens to the extension webview, or `--vscode-*` values to the site.
