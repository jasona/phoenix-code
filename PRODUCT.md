# Phoenix

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Developers running coding agents (local models and cloud providers) across their own workstation and remote SSH-connected machines, working in long daily coding sessions across threads, diffs, and terminals.

## Product Purpose

Phoenix is a fast, minimal, local-model-first, zero-telemetry GUI for coding agents. It is an independent, unofficial fork of M3 Code (itself a fork of T3 Code) that wraps local inference servers and coding-agent harnesses (Pi, OpenCode, Codex, Claude Code, NoName, and others) behind a single desktop and web workspace.

## Positioning

Local hardware comes first and nothing phones home. Phoenix treats your own GPUs and SSH machines as first-class citizens—with a built-in inference server registry, per-server request queueing gateway, automatic vision probing, runaway-reply watchdogs, and local compute telemetry—while deleting all analytics, crash-reporting, and identity-tracking pipelines from the codebase. Cloud providers remain available when explicitly chosen, never as a silent fallback.

## Operating Context

- Primary working surface: the React/Vite app in `apps/web`, shipped standalone in the browser and wrapped as an Electron desktop app (`apps/desktop`) across Linux, macOS, and Windows.
- Companion surfaces in the same monorepo: React Native mobile client (`apps/mobile`), Astro site (`apps/marketing`), and Node/Effect orchestration server (`apps/server`).
- Used for hours at a time alongside editors and terminals over local, LAN, Tailscale, and SSH connections.
- Key daily workflows: switching projects and threads in the sidebar, conversing with coding agents, reviewing diffs and tool calls, managing local inference servers and compute usage, and configuring providers and appearance.

## Capabilities and Constraints

- **Standalone product name:** **Phoenix** (not "Phoenix Code").
- **Zero telemetry:** No analytics, usage tracking, error/crash reporting, OTLP export, or install/device identifiers.
- **Trademark clean break:** MIT license covers source code only (`TRADEMARK.md`). All T3 Code and M3 Code names, wordmarks, logos, application icons, and visual trade dress must be replaced with Phoenix's own brand while keeping factual unofficial-fork attribution.
- **Performance without compromise:** No continuously repainting CSS animations (`AGENTS.md`); keep WebSocket updates, scrolling timelines, and high-refresh desktop rendering lean.
- **Multi-theme architecture:** `packages/shared/src/themePalettes.ts` defines semantic `THEME_COLOR_ROLES` supporting Light, Dark, OLED, built-in themes, and user-imported themes; `apps/web/src/index.css` uses Tailwind v4.
- **UI primitive boundaries:** `apps/web/src/components/ui` components own their styling (`shadcn/no-restyle`).
- **Open / undecided:** Whether `apps/mobile` and `apps/marketing` will be rebranded in the same pass or in follow-up slices (focus initial brand & style retrofit on `apps/web`, `apps/desktop`, and shared `assets/` / `packages/shared`).

## Brand Commitments

- Name: **Phoenix**.
- Establish a fresh, distinct Phoenix brand, logo/icon mark, and visual style grounded in the app's local-first engineering character—replacing inherited M3/T3 branding rather than polishing it.

## Evidence on Hand

- Existing application code: `apps/web`, `apps/desktop`, `apps/mobile`, `apps/marketing`, `packages/shared/src/themePalettes.ts`.
- Existing icon pipeline and source assets: `assets/` (`assets/README.md`, `assets/{prod,dev,nightly}/app-icon.icon`, `assets/prod/logo.svg`).
- Existing product screenshots: `pics/` (M3 Code incumbent UI, reference only—to be superseded by Phoenix branding).
- No approved Phoenix logo, palette, or `DESIGN.md` exists yet.

## Product Principles

- Local hardware first, cloud optional, telemetry zero.
- Precision and calm over decoration on working screens: hierarchy, scanability, and low GPU cost come first.
- Make runtime truth obvious: always show which model, machine, and inference server is doing the work.
- Clean visual independence from upstream T3 Code and M3 Code while preserving familiar developer ergonomics.
