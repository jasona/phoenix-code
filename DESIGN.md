---
name: Phoenix
description: Obsidian Forge — high-fidelity, tactile dark-craft workbench for local-first coding agents.
colors:
  signal-orange: "#e85d26"
  signal-orange-light: "#c84614"
  ember-gold: "#fbbf24"
  ember-ivory: "#fffdf0"
  forged-crimson: "#a51b10"
  volcanic-ash: "#58534e"
  hardware-sage: "#3fa66b"
  hardware-sage-light: "#267d4b"
  drafting-amber: "#e5a93c"
  fault-crimson: "#e5484d"
  anodized-charcoal: "#141312"
  obsidian-deep: "#0b0a0a"
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
  control: "6px"
  surface: "10px"
  medallion: "22%"
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

**Creative North Star: "Obsidian Forge"**

Phoenix pairs the clarity of a precision engineering workbench with high-fidelity, tactile visual craft. Rather than austere, bare-text-only minimalism, Phoenix embraces rich obsidian depth, subtle top-lit metallic rim highlights, luminous stepped ember gradients on brand moments, and deliberate spatial hierarchy that makes local GPUs, SSH workstations, inference queues, and coding agents feel like flagship craft software.

Warm obsidian grounds (`#141312` canvas, `#1c1b19` stone panels, `#0b0a0a` deep medallion wells) anchor the workspace so the luminous **Rising Plume** mark, active indicators, diffs, and floating surfaces carry crisp tactile dimensionality without ever sacrificing scanability or frame-rate discipline.

**Key Characteristics:**

- Rich warm obsidian surfaces (`#141312` standard dark, `#000000` OLED, `#f3f1ec` daylight paper) with tactile tonal layering, hairline top-edge specular highlights, and refined ambient depth on floating layers.
- Luminous stepped fire spectrum for the brand mark and high-emphasis moments — sunlit ivory-gold (`#fffdf0` / `#fbbf24`), Signal Orange (`#e85d26` / `#c84614`), and forged crimson (`#a51b10`) grounded by cool volcanic ash (`#58534e`).
- Polished hardware radii (`6px` controls, `10px` panels/cards, `22%` squircle brand medallions) paired with crisp `1px` borders and subtle inset highlights.
- Self-hosted Public Sans for UI legibility and JetBrains Mono for code, diffs, and hardware telemetry.
- High-fidelity **Rising Plume** emblem (five precision-tapered flame feathers with sculpted midrib cutouts ascending from a golden ember spark and faceted volcanic ash diamond) paired with the wide-tracked geometric `PHOENIX` vector wordmark.

## Colors

The palette pairs warm obsidian neutrals with a disciplined luminous fire accent ramp and honest semantic status tones.

### Primary & Brand Fire Ramp

- **Signal Orange** (`#e85d26` in dark/OLED; **Deep Signal Orange** `#c84614` in light): Primary actions, keyboard focus rings, terminal cursor, active selection accents, and the core ember band of the Rising Plume mark. Dark-ink foreground (`#141312`) maintains >5.4:1 contrast in dark mode; white (`#ffffff`) maintains >5.0:1 contrast in light mode.
- **Ember Gold** (`#fbbf24`) & **Ember Ivory** (`#fffdf0`): Crown highlights of the Rising Plume emblem, subtle warm radial underglow on hero medallions, and elevated brand moments.
- **Forged Crimson** (`#a51b10`) & **Volcanic Ash** (`#58534e`): Outer wing plume depth and the faceted ash diamond grounding the Rising Plume mark.

### Secondary

- **Hardware Sage** (`#3fa66b` dark / `#267d4b` light): Live local inference readiness, vision capability checks, and diff additions.
- **Drafting Amber** (`#e5a93c` dark / `#c88618` light): Queued inference runs, warnings, and search highlights.
- **Fault Crimson** (`#e5484d` dark / `#c9373a` light): Runtime errors, failed tool runs, and diff deletions.

### Neutral

- **Obsidian Deep** (`#0b0a0a`) & **Anodized Charcoal** (`#141312`): Default dark workspace canvas, terminal ground, and rich icon well.
- **Machined Stone** (`#1c1b19`): Default dark sidebar, cards, and elevated toolbars.
- **Workshop Slate** (`#242220`): Hover states, composer surface, popovers, and user turn bubbles in dark mode.
- **Stone Rule** (`#302d2a`): Crisp 1px structural borders and dividers in dark mode.
- **Warm Chalk** (`#f0ede6`) & **Anodized Ash** (`#9c968e`): Primary body text and secondary metadata labels in dark mode.
- **OLED Void** (`#000000`): True-black canvas when OLED appearance is explicitly selected.
- **Daylight Paper** (`#f3f1ec`), **Daylight Panel** (`#faf9f6`), **Daylight Stone** (`#eae7df`), **Daylight Ink** (`#1c1b19`), **Daylight Ash** (`#635e57`), and **Daylight Rule** (`#d8d3c9`): High-contrast warm daylight surface hierarchy.

### Named Rules

**The Focal Warmth Rule.** Reserve the luminous fire gradient and radial ember glow for the Rising Plume emblem, splash/onboarding lockups, and focal brand surfaces; keep everyday workspace chrome grounded in warm obsidian so primary actions (`#e85d26` / `#c84614`) stand out cleanly.
**The Hardware Honesty Rule.** Local-ready green (`#3fa66b`) and fault red (`#e5484d`) appear only on real runtime state (inference servers, queue status, diffs), never as decorative ornament.

## Typography

**Display Font:** Public Sans Variable (fallback: `-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif`)
**Body Font:** Public Sans Variable (same stack)
**Label/Mono Font:** JetBrains Mono Variable (fallback: `"SF Mono", "SFMono-Regular", Menlo, Consolas, monospace`)

**Character:** Clean, confident grotesque proportions engineered for long-hour scanability paired with crisp tabular monospace figures for diffs, token rates, and latency readouts.

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

Phoenix uses a multi-pane desktop/web workbench shell: a fixed-width obsidian sidebar (`~268px–276px`, collapsible) housing the Rising Plume lockup, thread creation, project-grouped thread list, and local/SSH host rack; a central conversation and diff lane (`46rem` comfortable reading measure); and optional docked right/bottom drawers for diffs, previews, and integrated terminals.

Spacing follows a 4px base grid (`4px`, `8px`, `12px`, `16px`, `24px`) with tight intra-group rhythm (`4px–8px`) and generous breathing room between major work groups (`16px–24px`).

## Elevation & Depth

Phoenix uses **tactile obsidian layering**: subtle surface value steps (`#141312` canvas -> `#1c1b19` stone sidebar/cards -> `#242220` raised composer/popovers), top-edge metallic hairline highlights (`--inset-shadow-control-highlight`), and calibrated ambient shadows on floating layers (`--shadow-composer-dark`, glass dialogs, brand medallions, and popovers). High-fidelity richness comes from light, material contrast, and crisp geometry — never from muddled blur stacks or distracting clutter.

### Named Rules

**The Zero-Cost Motion Rule.** Never ship continuously repainting CSS animations; status indicators and transitions settle cleanly (`180ms` exponential ease-out) so 120Hz displays stay idle at rest.

## Shapes

Form language balances precision with tactile polish: `6px` radius on controls and chips, `10px` radius on panels and floating containers, and `22%` squircle framing (`rx="28"` in a `128×128` viewBox) on the Rising Plume app icon and medallion plate.

### Phoenix Mark Geometry ("Rising Plume")

The canonical Phoenix mark (`PhoenixMark`, `128×128` viewBox) depicts a stylized phoenix rising from ashes through five symmetrical, precision-tapered flame feathers above a golden ember spark and a faceted volcanic ash diamond:

1. **Central Crown Plume** (`#FFFDF0` -> `#FEF08A` -> `#FBBF24` -> `#EA580C`): Tall, sculpted flame-teardrop core rising above the spark.
2. **Inner Flame-Feathers** (`#FDBA74` -> `#FB923C` -> `#EA580C` -> `#B91C1C`): Paired upward-curving plumes mirrored across `x = 64`, each carved with a crisp negative-space midrib slit.
3. **Outer Wing-Feathers** (`#F05218` -> `#CF2F14` -> `#A51B10` -> `#7A120D`): Wide sweeping outer wings mirrored across `x = 64`, also carrying sculpted negative-space midrib cuts.
4. **Rising Ember Spark** (`#FFFBEB` -> `#FDE047` -> `#F59E0B`): Crisp 4-point star poised cleanly in the cradle between ash and flame.
5. **Faceted Ash Diamond** (`#7B756F`/`#58534E` lit facet, `#524D49`/`#3A3633` shaded facet): Grounding volcanic ash crystal at the base.
6. **Variants**:
   - `plate`: High-fidelity obsidian squircle medallion (`#1D1917` -> `#0B0A0A` radial surface, warm ember underglow, and top-lit brushed metallic rim `#584F49` -> `#1C1917`) for sidebar headers, onboarding/standalone headers, and app icons.
   - `brand`: Transparent-background full-color Rising Plume emblem for Icon Composer layers, DMG art, and custom surfaces.
   - `mono`: Crisp `currentColor` silhouette (with `0.58` opacity on the ash diamond) for 16px tool rows and monochrome system icons.

Paired with the wide-tracked geometric uppercase `PHOENIX` vector wordmark (`PhoenixWordmark`, `175×28` viewBox).

## Components

Controls come from `apps/web/src/components/ui` (`shadcn/no-restyle`) and inherit semantic CSS variables from `index.css` and `themePalettes.ts`.

### Buttons

- **Shape:** Tactile `6px` radius.
- **Primary:** Signal Orange fill (`#e85d26` dark / `#c84614` light) with crisp top-edge inset highlight and high-contrast dark charcoal (`#141312`) or white (`#ffffff`) text, `6px 14px` padding, `600` weight.
- **Hover / Focus:** Deepens cleanly (`#d1501d` / `#b03c10`) with a 2px `--ring` focus-visible outline (`2px` offset).
- **Secondary / Ghost:** Workshop Slate (`#242220`) fill with 1px `#302d2a` stroke, or transparent with subtle `--accent` hover fill.

### Chips

- **Style:** `6px` radius (`#242220` background, `1px solid #302d2a`), `JetBrains Mono` `11px` tabular labels (`LOCAL · spark5`, `84 tok/s`).
- **State:** Hardware Sage (`#3fa66b`) text/border when indicating ready local inference; neutral ash (`#9c968e`) when informational.

### Cards / Containers

- **Corner Style:** `10px` radius on standalone surfaces and elevated panels.
- **Background:** `#1c1b19` (`--card`) in standard dark, `#0d0c0b` in OLED, `#faf9f6` in light.
- **Depth Strategy:** Subtle tonal contrast + 1px border separation, with refined ambient elevation on detached dialogs, glass overlays, and floating composers. Avoid gratuitous nested boxes inside settings groups.

### Inputs / Fields

- **Style:** `#242220` / `#141312` inset surface, `1px` `--input` border (`#3a3632`), Signal Orange text caret (`caret-color: var(--primary)`).
- **Focus:** `1px` border shift to `--ring` (`#e85d26`) plus clear `:focus-visible` ring.

### Navigation

- **Sidebar:** Committed `#1c1b19` stone rail (`#eae7df` in light) separated by a 1px `#302d2a` right border. Topped by `PhoenixMark` (`variant="plate"`, `24px`, Rising Plume obsidian medallion) + `PhoenixWordmark` (`14px` geometric uppercase `PHOENIX`), followed by project-grouped thread rows where active rows sit on `#292623` (`--sidebar-row-active`) and secondary metadata dims to `#9c968e`.

### Hardware Server Status Unit

- Compact sidebar/settings block showing machine name, active model, `tok/s` rate in Hardware Sage (`#3fa66b`), and capability metadata (`Local · Reads images · 128k`). Unreachable hosts dim to `50%` opacity with muted indicator dots.

## Do's and Don'ts

### Do:

- **Do** bring high-fidelity material polish — subtle top-lit hairlines, calibrated elevation, and crisp visual hierarchy — to brand touchpoints, medallions, onboarding, and flagship surfaces.
- **Do** use the **Rising Plume** `PhoenixMark` (`plate` / `brand` / `mono`) and `PhoenixWordmark` (`PHOENIX`) consistently across desktop, web, mobile, DMG, and docs.
- **Do** pair `Public Sans Variable` for UI prose with `JetBrains Mono Variable` for code, diffs, and numeric hardware telemetry.
- **Do** preserve full compatibility with `THEME_COLOR_ROLES` across Light, Standard Dark, OLED, and user-imported themes.

### Don't:

- **Don't** reintroduce T3 Code or M3 Code names, wordmarks, icons, or royal-blue (`#1b4ed8` / `#346bf1`) default accents.
- **Don't** add continuously repainting CSS animations that peg the GPU on high-refresh displays.
- **Don't** sacrifice legibility or scannability for ornamental clutter — polish should sharpen hierarchy, never obscure code or diffs.
- **Don't** restyle `apps/web/src/components/ui` primitives inline from parent components; define shared variants on the primitives themselves.
