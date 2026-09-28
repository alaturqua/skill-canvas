---
target: src/canvasEditor.ts
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
target_identity: "file:D:\\Projects\\skill-canvas\\src\\canvasEditor.ts"
target_fingerprint: "sha256:dfae52c37a551909d0e11e6038c816badf25cb151d869404651004fff0db43d6"
target_path: "D:\\Projects\\skill-canvas\\src\\canvasEditor.ts"
timestamp: 2026-09-28T23-04-40Z
slug: src-canvaseditor-ts
---
Method: dual-agent (A: design review · B: detector evidence)

# Critique round 2: Skill Canvas editor — 27/40 (was 22/40)

| # | Heuristic | Score | Key Issue |
|---|---|---|---|
| 1 | Visibility of System Status | 3 | Status line small/truncated; drawer hides the selected block at narrow widths |
| 2 | Match System / Real World | 3 | Path/tool-ID jargon; "to fix" counts notes |
| 3 | User Control and Freedom | 3 | Replacing files the canvas didn't create is pre-checked and permanent; drawer lacks close |
| 4 | Consistency and Standards | 3 | Copilot target changes the form; "uses/Link/Skills it knows" naming |
| 5 | Error Prevention | 3 | Overlapping blocks; "Ready" when nothing exportable |
| 6 | Recognition Rather Than Recall | 2 | Palette icon-only and shortcuts hidden at <=1200px; hidden uses handle |
| 7 | Flexibility and Efficiency | 2 | No multi-select/copy/tidy/keyboard linking/one-step re-export |
| 8 | Aesthetic and Minimalist Design | 3 | Long agent panel; duplicated hints; yes/no twice |
| 9 | Error Recovery | 2 | Unparseable canvas opens empty; export errors swallowed |
| 10 | Help and Documentation | 3 | Help disappears at narrow widths |
| Total | | 27/40 | Acceptable (top of band) |

## Design specificity
Authored in copy and preview (plain-language fields, rendered file with highlighted step, theme discipline); interchangeable in composition and block form. Canvas never shows the result (no step numbers, files or /commands on blocks).
Detector: CLI clean of real issues. In-page real: light placeholder contrast 4.3:1 on #wf-name; Preview/File tabs 19px tall (below 24px target). Review found HC checkbox/radio accent invisible (#000). False positives: ai-color-palette on theme-token icons, body clip (app frame), li.hl spacing/gray-on-color, hidden text-occlusion.

## Priority issues
1. [P1] Core loop breaks at real widths (<=1200px icon-only palette, shortcuts hidden; <=760px drawer covers starter and edited block; reveal/fit ignore drawer; fit floor 0.6 → ~7.8px names). Fix: labels on hover/focus, "?" shortcuts, drawer opens on selection with close + Esc, subtract drawer, compact blocks at low zoom. Command: adapt.
2. [P1] Canvas drawing misrepresents the graph (back-edges through blocks, e.g. "no" edge through Agent 2's input; free overlap on drag/drop/duplicate; yes/no twice). Fix: route below span, nudge apart + Tidy up, one label, step numbers on blocks. Command: layout.
3. [P1] Silent failures can lose/overwrite files (invalid JSON → empty canvas then full overwrite; export errors uncaught; files the canvas didn't create pre-checked and overwritten). Fix: blocking parse-error state, try/catch + error to canvas, those files unchecked or trashed first. Command: harden.
4. [P2] Copilot target pushes tool IDs/model names on the user; target switch unlabeled. Fix: shared plain-language tool options mapped per target, model select for both, visible label or export-time choice. Command: clarify.
5. [P2] Preview buried below ~9 sections; noisy first-run panel; hint+warning duplicated; "N to fix" mixes notes. Fix: sticky result line or Details/File tabs, hide empty sections, replace hint by warning, group issues. Command: distill.

## Persona red flags
Jordan: unlabeled icons at 1000px; uses handle unknown; "2 to fix" after starter; pre-checked replace.
Sam: HC checks invisible; target selection bold-only; Tool linking drag-only; double announcement; Space pans on role=button; 200% zoom → drawer.
Alex: no multi-select/copy/tidy; two pickers per re-export; path not clickable.
Priya: 7-row Instructions; unreadable 60% fit; drawer covers block; Copilot tool IDs; can't find "step 2".

## Minor observations
"Ready" for lone Input; used Skill still offers Next step; typing 0 in Repeat shows 0/stores 1; Delete undistinguished; workflow name editable only on hover; Workflow header shares logic cyan; tabs lack aria-controls, zoom toolbar no arrow roving; status line truncates; no "Copied" state on chip.

## Questions to consider
Step numbers and results on blocks? Canvas-first layout? Export target at export time / both at once? Step-list editor with graph as view?
