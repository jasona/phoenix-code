---
name: Phoenix
description: Anodized Workshop — warm-charcoal industrial workbench for local-first coding agents.
colors:
  signal-orange: "#e85d26"
  signal-orange-light: "#c84614"
  hardware-sage: "#3fa66b"
  hardware-sage-light: "#267d4b"
  drafting-amber: "#e5a93c"
  fault-crimson: "#e5484d"
  anodized-charcoal: "#141312"
  machined-stone: "#1c1b19"
  workshop-slate: "#242220"
  stone-rule: "#302d2a"
  warm-chalk: "#f0ede6"
  anodized-ash: "#9c968e"
  oled-void: "#000000"
  daylight-paper: "#f3f1ec"
  daylight-panel: "#faf9f6"
  daylight-stone: "#eae7df"
  daylight-ink: "#1c1b19"
  daylight-ash: "#635e57"
  daylight-rule: "#d8d3c9"
typography:
  display:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "1.375rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.35
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  body:
    fontFamily: "Public Sans Variable, Public Sans, system-ui, sans-serif"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0em"
  label:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, monospace"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: 1.3
    letterSpacing: "0.02em"
  code:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "0em"
rounded:
  control: "4px"
  surface: "6px"
  pill: "9999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.signal-orange}"
    textColor: "{colors.anodized-charcoal}"
    typography: "{typography.title}"
    rounded: "{rounded.control}"
    padding: "6px 14px"
  button-primary-hover:
    backgroundColor: "#d1501d"
  button-secondary:
    backgroundColor: "{colors.workshop-slate}"
    textColor: "{colors.warm-chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "6px 12px"
  badge-hardware:
    backgroundColor: "{colors.workshop-slate}"
    textColor: "{colors.hardware-sage}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "3px 8px"
  card-panel:
    backgroundColor: "{colors.machined-stone}"
    textColor: "{colors.warm-chalk}"
    rounded: "{rounded.surface}"
    padding: "14px 16px"
  input-composer:
    backgroundColor: "{colors.workshop-slate}"
    textColor: "{colors.warm-chalk}"
    typography: "{typography.body}"
    rounded: "{rounded.surface}"
    padding: "12px 14px"
---

# Design System: Phoenix

## Overview

**Creative North Star: "Anodized Workshop"**

Phoenix draws from Dieter Rams / Braun industrial hardware specifications rather than cold zinc-and-electric-blue SaaS interfaces or literal flame gradients. Local GPUs, SSH workstations, inference queues, and coding agents are treated as calm, physical workshop equipment designed for multi-hour daily engineering sessions.

The workbench pairs warm anodized charcoal surfaces with matte stone panels, crisp 1px structural dividers, and disciplined Braun Signal Orange reserved strictly for the active Phoenix spine, primary actions, and focused state. Navigation, diffs, and timelines remain instantly scannable to developers while eliminating nested card bloat and continuously repainting GPU animations.

**Key Characteristics:**

- Warm anodized charcoal grounds (`#141312` standard dark, `#000000` OLED, `#f3f1ec` daylight paper) instead of blue-tinted zinc.
- Disciplined Signal Orange (`#e85d26` dark, `#c84614` light) strictly for primary actions, focus rings, and the central Phoenix spine bar.
- Precision 4px control and 6px panel radii paired with 1px hairline stone dividers instead of drop-shadow stacks.
- Self-hosted Public Sans for UI legibility and JetBrains Mono for code, diffs, and hardware telemetry.
- Anodized hardware medallion emblem (paired rising angular wings flanking a Signal Orange ember spear) and wide-tracked geometric `PHOENIX` vector wordmark.

## Colors

The palette is warm-neutral and hardware-honest, with semantic status colors layered sparingly over anodized grounds.

### Primary

- **Signal Orange** (`#e85d26` in dark/OLED; **Deep Signal Orange** `#c84614` in light): Used strictly for the primary send/submit action, keyboard focus ring, terminal cursor, active selection tint, and the central spine of the Phoenix mark. Dark-ink foreground (`#141312`) ensures >5.4:1 contrast in dark mode; crisp white (`#ffffff`) ensures >5.0:1 contrast in light mode.

### Secondary

- **Hardware Sage** (`#3fa66b` dark / `#267d4b` light): Indicates live local inference readiness, vision capability checks, and diff additions.
- **Drafting Amber** (`#e5a93c` dark / `#c88618` light): Reserved for queued inference runs, warnings, and search highlights.
- **Fault Crimson** (`#e5484d` dark / `#c9373a` light): Reserved strictly for runtime errors, failed tool runs, and diff deletions.

### Neutral

- **Anodized Charcoal** (`#141312`): Default dark workspace canvas, terminal ground, and primary foreground ink on Signal Orange.
- **Machined Stone** (`#1c1b19`): Default dark sidebar, cards, and elevated toolbars, creating a calm two-tone split against the main workspace.
- **Workshop Slate** (`#242220`): Hover states, composer surface, popovers, and user turn bubbles in dark mode.
- **Stone Rule** (`#302d2a`): Crisp 1px structural borders and dividers in dark mode.
- **Warm Chalk** (`#f0ede6`) & **Anodized Ash** (`#9c968e`): Primary body text and secondary metadata labels in dark mode.
- **OLED Void** (`#000000`): True-black canvas when OLED appearance is explicitly selected, preserving warm chalk ink (`#f0ede6`) and Signal Orange (`#e85d26`).
- **Daylight Paper** (`#f3f1ec`), **Daylight Panel** (`#faf9f6`), **Daylight Stone** (`#eae7df`), **Daylight Ink** (`#1c1b19`), **Daylight Ash** (`#635e57`), and **Daylight Rule** (`#d8d3c9`): High-contrast warm daylight surface hierarchy.

### Named Rules

**The Signal Orange Budget Rule.** Signal Orange (`#e85d26` / `#c84614`) owns at most one primary focal action per view plus the Phoenix brand spine; never flood backgrounds, badges, or secondary buttons with orange.
**The Hardware Honesty Rule.** Local-ready green (`#3fa66b`) and fault red (`#e5484d`) appear only on real runtime state (inference servers, queue status, diffs), never as decorative ornament.

## Typography

**Display Font:** Public Sans Variable (fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`)
**Body Font:** Public Sans Variable (same stack)
**Label/Mono Font:** JetBrains Mono Variable (fallback: `"SF Mono", "SFMono-Regular", Menlo, Consolas, monospace`)

**Character:** Grounded, unadorned grotesque proportions engineered for long-hour scanability paired with crisp tabular monospace figures for diffs, token rates, and latency readouts.

### Hierarchy

- **Display** (`700`, `1.375rem` / `22px`, `1.2` line-height, `-0.02em` tracking): Standalone onboarding/auth headers and splash lockups.
- **Headline** (`600`, `0.9375rem` / `15px`, `1.35` line-height, `-0.015em` tracking): Thread header titles and settings section headers.
- **Title** (`600`, `0.875rem` / `14px`, `1.4` line-height, `-0.01em` tracking): Sidebar brand wordmark (`Phoenix`), project headings, and primary button labels.
- **Body** (`400`, `0.8125rem` / `13px`, `1.5` line-height, `65–75ch` measure): Conversation turns, sidebar thread items, and setting descriptions.
- **Label** (`500`, `0.6875rem` / `11px`, `1.3` line-height, `+0.02em` tracking, tabular figures): Hardware status chips, `tok/s` readouts, branch pills, and timestamps.
- **Code** (`400`, `0.75rem` / `12px`, `1.55` line-height): Inline code, unified diffs, terminal panes, and JSON configurations.

### Named Rules

**The Tabular Metric Rule.** Every numerical readout (TTFT, `tok/s`, context size, token counts, diff counts) uses `JetBrains Mono` with tabular numerals so columns never jitter while streaming.

## Layout

Phoenix uses a crisp multi-pane desktop/web workbench shell: a fixed-width anodized sidebar (`~268px–276px`, collapsible) housing the Phoenix lockup, thread creation, project-grouped thread list, and local/SSH host rack; a central conversation and diff lane (`46rem` comfortable reading measure); and optional docked right/bottom drawers for diffs, previews, and integrated terminals.

Spacing follows a 4px base grid (`4px`, `8px`, `12px`, `16px`, `24px`) with tight intra-group rhythm (`4px–8px`) and clear separation between work groups (`16px–24px`).

## Elevation & Depth

Phoenix is **tonally layered and flat at rest**, relying on surface value steps (`#141312` canvas -> `#1c1b19` stone sidebar/cards -> `#242220` raised composer/popovers) and 1px stone borders (`#302d2a`) instead of heavy elevation shadows. Ambient shadow appears only on detached floating layers (`--shadow-composer-dark: 0 14px 32px -18px rgb(0 0 0 / 75%)` and floating menus/dialogs).

### Named Rules

**The Zero-Cost Motion Rule.** Never ship continuously repainting CSS animations; status indicators and skeletons step discreetly or transition once (`180ms` exponential ease-out) so 120Hz displays stay idle at rest.

## Shapes

Form language favors machined hardware precision: `4px` radius (`--control-radius`) on buttons, badges, and inputs; `6px` radius (`--radius`) on cards, composers, and dialogs; and rounded-square `22/128` (`~17%`) app icon framing.

### Phoenix Mark Geometry

The canonical Phoenix mark (`PhoenixMark`, `128×128` viewBox) pairs twin symmetrical rising 3-plume angular wings (`#F0EDE6` / `currentColor`) flanking a centered Signal Orange ember spear (`#E85D26` / `var(--primary)`):

1. Center Ember Spear (`#E85D26` in `brand` / `plate` variants; `currentColor` in `mono`)
2. Twin 3-Plume Angular Wings (`#F0EDE6` / `currentColor`) mirrored cleanly across `x = 64`
3. Optional Chamfered Hardware Medallion bezel (`variant="plate"`, `#242220` / `var(--card)` recessed plate + `var(--border)` chamfered rim) for sidebar and standalone header lockups alongside the wide-tracked geometric uppercase `PHOENIX` vector wordmark (`PhoenixWordmark`, `175×28` viewBox)

Maintain generous outer clearspace so the emblem silhouette remains crisp from `16×16` favicons to `1024×1024` desktop icons.

## Components

Controls come from `apps/web/src/components/ui` (`shadcn/no-restyle`) and inherit semantic CSS variables from `index.css` and `themePalettes.ts`.

### Buttons

- **Shape:** Machined `4px` radius (`--control-radius`).
- **Primary:** Signal Orange fill (`#e85d26` dark / `#c84614` light) with high-contrast dark charcoal (`#141312`) or white (`#ffffff`) text, `6px 14px` padding, `600` weight.
- **Hover / Focus:** Darkens cleanly (`#d1501d` / `#b03c10`) with a 2px `--ring` focus-visible outline (`2px` offset).
- **Secondary / Ghost:** Workshop Slate (`#242220`) fill with 1px `#302d2a` stroke, or transparent with subtle `--accent` hover fill.

### Chips

- **Style:** `4px` radius (`#242220` background, `1px solid #302d2a`), `JetBrains Mono` `11px` uppercase or technical labels (`LOCAL · spark5`, `84 tok/s`).
- **State:** Hardware Sage (`#3fa66b`) text/border when indicating ready local inference; neutral ash (`#9c968e`) when informational.

### Cards / Containers

- **Corner Style:** `6px` radius (`--radius`).
- **Background:** `#1c1b19` (`--card`) in standard dark, `#0d0c0b` in OLED, `#faf9f6` in light.
- **Shadow Strategy:** Flat at rest with `1px` border separation; no nested cards inside detail panes (`[data-provider-detail] [data-slot="settings-group"]` strips inner card chrome).

### Inputs / Fields

- **Style:** `#242220` / `#141312` inset surface, `1px` `--input` border (`#3a3632`), `4px–6px` radius, Signal Orange text caret (`caret-color: var(--primary)`).
- **Focus:** `1px` border shift to `--ring` (`#e85d26`) plus clear `:focus-visible` ring.

### Navigation

- **Sidebar:** Committed `#1c1b19` anodized stone rail (`#eae7df` in light) separated by a 1px `#302d2a` right border. Topped by `PhoenixMark` (`variant="plate"`, `24px`) + `PhoenixWordmark` (`14px` geometric uppercase `PHOENIX`), followed by project-grouped thread rows where active rows sit on `#292623` (`--sidebar-row-active`) and secondary metadata dims to `#9c968e`.

### Hardware Server Status Unit

- Compact sidebar/settings block showing machine name, active model, `tok/s` rate in Hardware Sage (`#3fa66b`), and capability metadata (`Local · Reads images · 128k`). Unreachable hosts dim to `50%` opacity with muted indicator dots.

## Do's and Don'ts

### Do:

- **Do** keep Signal Orange (`#e85d26` / `#c84614`) scarce so primary actions and the Phoenix mark spine command immediate visual priority.
- **Do** use the anodized medallion `PhoenixMark` (`plate` / `brand` / `mono`) and `PhoenixWordmark` (`PHOENIX`) everywhere the product identifies itself.
- **Do** pair `Public Sans Variable` for UI prose with `JetBrains Mono Variable` for code, diffs, and numeric hardware telemetry.
- **Do** preserve full compatibility with `THEME_COLOR_ROLES` across Light, Standard Dark (`Anodized Workshop`), OLED, and user-imported themes.

### Don't:

- **Don't** reintroduce T3 Code or M3 Code names, wordmarks, icons, or royal-blue (`#1b4ed8` / `#346bf1`) default accents.
- **Don't** add glowing neon borders, gradient text, flame illustrations, or continuously repainting CSS animations.
- **Don't** nest bordered cards inside cards on settings or detail panels; use 1px dividers and spacing instead.
- **Don't** restyle `apps/web/src/components/ui` primitives inline from parent components; define shared variants on the primitives themselves.
