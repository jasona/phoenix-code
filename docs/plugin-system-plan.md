# Phoenix plugin system plan

Status: runtime, authoring tools, scoped host actions, agent launches, project pages, and mobile implementation are delivered. External-client verification remains open.

## Delivery status

- Implemented: supervised sidecars with bounded logs and crash recovery; persisted configuration and project/capability grants; scoped context subscriptions, transcript/file pages, composer attachments, message/create-thread actions, and temporary model context.
- Implemented: scaffold/validate/schema/install/reload CLI, source SDK export, generated manifest schema, and updated authoring/user guides.
- Implemented: command-palette entry, agent launch subscriptions, project/full-page views, native mobile plugin screen, version negotiation, and the Project Board completion-recording sidecar.
- Verified: focused server lifecycle/host/auth tests, shared bridge compatibility tests, CLI install/enable/reload, and package typechecks for web, mobile, and client-runtime. The final server typecheck has no plugin errors but reports unrelated diagnostics in lifecycle hooks and ProviderSessionManager.
- Verified: real-browser installation, permission grant, task persistence, composer attachment, restart/reopen, full-page project scope, disable revocation, and agent-triggered reopening. This exposed and fixed a StrictMode frame-remount bug by moving instance ownership into the view subscription.
- Still open: native iOS/Android execution (Device hub and Agent device access are disabled in this session); Electron-shell and real cross-machine relay/tunnel acceptance; live-model plugin discovery eval (no model endpoint configured). Web-renderer proof does not substitute for these checks.
- Plugin UI catalogs were regenerated and new strings translated across the nine non-English locales.

The SDK is available in this source checkout; no package registry publication was performed. Marketplace distribution, automatic updates, custom file viewers, and broad hooks/rules packaging remain outside this plan's core scope.

See [using plugins](user/plugins.md), the [authoring guide](../examples/plugins/project-board/README.md), and the [manifest schema](phoenix-plugin.schema.json).

Research date: November 25, 2026.

## Goal

Let developers build apps that install into Phoenix, open as persistent contextual tabs, and optionally run background sidecars alongside coding agents. Plugins should work without an active model session and across local, remote, web, desktop, and mobile connections.

Build on Phoenix's existing MCP Apps support. Use standard MCP Apps for interactive HTML and a small Phoenix extension for workspace context and tab placement.

## Antigravity research

Antigravity separates three concerns:

- **Plugins** package a manifest, MCP servers, skills, agents, rules, and hooks into an installable directory. Local validation and installation are supported. See [Build plugins](https://antigravity.google/docs/build-plugins).
- **Sidecars** are explicitly enabled background processes with managed lifecycle, restart policies, persistent data, and logs. Their `agentapi` CLI can create conversations or send messages to existing conversations. See [Sidecars](https://antigravity.google/docs/sidecars).
- **MCP Apps** provide interactive HTML views. Antigravity adds entrypoints for side-panel tabs, full-page views, and file viewers. Views can open manually or from tool calls; repeated calls update an existing side-panel tab. Views can send messages and contribute model context, while global views omit conversation-specific capabilities. See [MCP Apps](https://antigravity.google/docs/mcp-apps).

The pattern to adopt is one installable package containing tools, UI, and optional background execution. Sidecars are execution units, not tab renderers. The Phoenix design below is a proposal, not a claim of compatibility with Antigravity's proprietary extensions.

## Existing Phoenix foundation

- [Shared MCP Apps host](../packages/client-runtime/src/mcpApps/host.ts): tool calls, resources, messages, model context, themes, and display modes.
- [Web renderer](../apps/web/src/components/chat/McpAppFrame.tsx) and [mobile renderer](../apps/mobile/src/features/threads/McpAppWebView.tsx).
- [Panel state](../apps/web/src/rightPanelStore.ts) and [panel tabs](../apps/web/src/components/RightPanelTabs.tsx).
- [MCP Apps contracts](../packages/contracts/src/mcpApps.ts) and [server request service](../apps/server/src/mcpApps/McpAppRequests.ts).

The main gap is lifecycle. Current MCP App requests resolve through a producing tool item and an active provider session. Persistent installed plugins need a server-owned runtime that works independently of conversation activity.

## 1. Plugin package and ownership

Introduce a versioned `phoenix.plugin.json` manifest describing:

- Stable plugin ID, display name, version, and compatible host API versions.
- MCP server entrypoints.
- Views and supported scopes: thread or project.
- Optional sidecar command, arguments, working directory, and restart policy.
- Requested Phoenix capabilities and configuration fields.

Use standard MCP Apps HTML resources and bridge messages for UI. Define a small, capability-negotiated Phoenix extension for tab placement and workspace context.

Install plugins on the environment that owns the workspace. Persist installation metadata, grants, enabled state, configuration, and plugin data on that server. Keep tab order and active-tab selection as client preferences.

Start with local-folder installation and development reload. A plugin discovered in a repository is available to install; opening the repository must not execute it automatically. Defer a marketplace, automatic updates, custom file viewers, and broad hooks/rules packaging until the core runtime works.

## 2. Provider-independent runtime

Add an Effect service under `apps/server/src/plugins` to own installation metadata, activation, MCP connections, and sidecar lifecycle. Use thin RPC and MCP adapters over service methods.

The runtime must:

- Start plugin MCP servers on demand.
- Keep explicitly enabled background sidecars running without an open tab.
- Avoid duplicate processes when multiple clients connect.
- Expose starting, ready, stopped, and failed states.
- Capture bounded logs and restart with backoff and a crash-loop limit.
- Stop owned processes and revoke access on disable or uninstall.
- Preserve plugin data unless the user explicitly deletes it.

An MCP server can itself perform background work; a separate sidecar is optional. Define ownership by environment, installation, and configured scope so project-specific instances do not accidentally share state.

Extend request targets to distinguish conversation-produced apps from installed-plugin views. Keep existing source-server restrictions for conversation apps; resolve installed-plugin requests through registered installations and instances. Do not make callers invent tool-item IDs to open a plugin.

Opening a tab must never start a model turn. Reuse the existing scheduler for scheduled work instead of adding a second scheduler.

## 3. Context and host actions

Provide a typed SDK over the shared host bridge with two explicit directions.

### Phoenix to plugin

Supply environment identity, bound project/thread, a workspace reference, theme, locale, and selected resources when permitted. Detailed transcript and file access must be requested explicitly, paginated, and permission-checked rather than included in every update.

Use subscriptions for permitted state changes, reconnect snapshots, and bounded updates. Bind requests to an instance and scope so stale views cannot act against a newly selected environment or thread.

### Plugin to Phoenix

Support approved operations to open a file, attach context to the composer, contribute bounded model context, send a message, and create a thread. Distinguish attaching context from sending a message or starting agent execution.

### Scope rules

- A thread view stays bound to its originating thread.
- A project view works without a conversation.
- A project view must select a conversation before performing conversation-specific actions.
- A background sidecar receives its configured scope, not whichever thread one connected device currently has open.
- Closing or disabling a view clears its transient subscriptions and applicable model-context contributions according to an explicit lifecycle policy.

## 4. Tabs and plugin management

Extend the existing panel model with a plugin surface. Preserve Phoenix's current visual language and panel interactions.

Primary flow:

1. Install and enable a plugin in **Settings → Plugins**.
2. Open its view from the panel **+ menu** or command palette.
3. Use it beside a conversation or expand it using existing panel behavior.
4. Close and reopen it without losing saved plugin data.

Use a stable tab identity composed of environment, plugin, view, and bound scope. Reopening the same view focuses the existing tab. Include keyboard access, close/reopen behavior, and translated user-facing copy.

Handle loading, disconnected, permission-denied, disabled, and crashed states. Failed views offer **Retry** and **View logs**. Closing a tab removes view subscriptions but does not silently disable an explicitly enabled background sidecar. Disabling a plugin stops execution and leaves any open tab in a clear disabled state.

On mobile, expose the same views through the existing WebView/fullscreen patterns. Execution remains on the server. Bound retained views and suspend unnecessary work in hidden tabs.

## 5. Permissions and remote access

Run UI in isolated frames/WebViews through the host bridge. Never expose Phoenix session tokens, unrestricted RPC clients, or direct Electron APIs to plugin UI.

Effective authority for host operations is the intersection of the plugin's grants, the requesting client or agent's permissions, and the bound project/thread scope. Background work uses its explicit installation grant and configured scope. Enforce restrictions server-side and reject calls after revocation.

A native sidecar runs as the server's OS user unless a separate process sandbox is implemented. API capability grants do not sandbox arbitrary native code. Installation must make that execution trust clear.

Route plugin resources and calls through the owning environment's authenticated transport. Do not expose server-local ports as client `localhost` URLs. Validate behavior through hosted web, remote connections, relay/tunnel routes, and route changes.

Negotiate plugin capabilities across independently versioned clients and servers. Unsupported clients should show a clear unavailable state without breaking ordinary conversations.

## 6. Implementation sequence

### Increment 1: working vertical slice

- Add manifest validation and local registration.
- Define installation/view request contracts and authorization.
- Manage one plugin MCP server independently of provider sessions.
- Open a manually launched tab with basic project/thread context.
- Reuse the shared bridge and web renderer.

Exit criterion: a local plugin opens and works with no model running.

### Increment 2: persistent execution

- Add explicit sidecar activation, supervision, bounded logs, and persistent data.
- Implement enable/disable, uninstall, restart recovery, and reconnect behavior.
- Prove multi-client process ownership and revocation.

Exit criterion: a sidecar survives tab closure and recovers from a crash without duplicating work or losing saved data.

### Increment 3: authoring experience

- Provide scaffold, validate, and development reload commands.
- Publish SDK types, manifest schema, and an example plugin.
- Document context binding, process trust, data ownership, and supported host actions.

Exit criterion: a developer can build and install the example without editing Phoenix itself.

### Increment 4: broader integration

- Add agent-triggered tab opening and approved background actions.
- Complete mobile behavior and remote/relay/tunnel verification.
- Add optional full-page views once project-scoped behavior is proven.
- Verify provider capability decisions and text fallbacks.

Plugin UI and runtime execution remain provider-independent. Provider-specific integration concerns discovery and invocation of plugin tools. Every provider adapter needs an explicit supported/fallback/unsupported decision.

## First proof: Project Board

Build an example plugin that lists tasks, persists changes, reacts to thread completion, and attaches a selected task to a conversation. An optional sidecar maintains the board while its tab is closed.

Acceptance criteria:

- Works without a running provider session.
- Works in local web, Electron, and a remote browser.
- Two clients share data without duplicating the sidecar.
- Thread switching cannot redirect an action to the wrong thread.
- Disable stops execution and rejects subsequent calls.
- Crash recovery preserves data without a restart loop.
- Mobile can open and operate the view.
- Hidden tabs stop unnecessary rendering and subscriptions.
- Close/reopen restores the correct view and scope.
- Older or unsupported clients fail gracefully.

## Verification and completion

Test service lifecycle, request ownership, permission intersections, revocation, reconnects, stale scope rejection, and multi-client deduplication. Extend existing bridge and renderer tests where behavior changes. Run focused checks during implementation and `vp run check:changed` before any push; avoid repo-wide checks.

Give user-visible work an integrated real-client pass on web/desktop and mobile using the repository's testing skills. Verify Settings, panel menus, command palette, keybindings, reverse actions, translations, and agent access. Measure bounded messages, retained views, and idle behavior so extensions preserve Phoenix's performance goals.

The implementation uses API version 1, `phoenix/request`, server-owned grants in the installation registry, and one MCP process plus one optional sidecar per installation. Background work has one explicit configured scope; UI instances have immutable project/thread scopes. Native execution remains trusted OS-user code. Completion events are bounded, best-effort notifications, not a durable queue.

Remaining acceptance gates must be checked on the actual surfaces and connection modes before calling the entire plan verified. The live-model eval case is `plugin-launch-existing-board` in `evals/mcp-tool-use/cases/plugins.ndjson`.
