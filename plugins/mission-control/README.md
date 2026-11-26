# Mission Control for Phoenix

Mission Control is a bundled Phoenix plugin, enabled on new and existing environments by default. Open its global workspace tab from the dashboard icon at the end of the sidebar’s bottom row, **Settings → Plugins → Mission Control**, or the command palette. The Workspace tab keeps the conversation and right panel mounted while Mission Control is visible. Disabling it persists across upgrades.

The interface is ported from Jason Alexander's MIT-licensed Antigravity Mission Control. Its Phoenix bridge uses authenticated plugin requests for project summaries, thread history, working-tree diffs, provider limits, and scheduled tasks. New conversations and replies use Phoenix's thread service. The Inbox separates decisions, failures, and review-ready results. Stopped runs with no pending requests or agent work can be dismissed without accepting their output or archiving the conversation. Settling a stopped thread also dismisses it; use the Dismissed list to reopen it. The native review desk keeps conversations, approvals, questions, diffs, file context, terminal, and preview inside Mission Control on web and desktop. Run controls respect provider capabilities and stale run IDs. Explicit acceptance is separate from reading; command evidence never treats agent prose as proof of successful checks.

Edit `ui/`, then regenerate the self-contained document:

```sh
node plugins/mission-control/build-client.mjs
node plugins/mission-control/build-client.mjs --check
```

Run these commands from the repository root. `document.json` is imported into the server bundle, so web, desktop, packaged servers, and remote clients do not need an extra asset directory, HTTP listener, or Node installation. The bundled adapter exposes the manifest's MCP tool and resource through the standard Phoenix plugin host. `server.mjs` also serves that resource over MCP stdio for protocol testing.

`mission-control` is a reserved bundled ID. Its environment-wide capability is available only to this embedded implementation; installing a local directory cannot claim it. Third-party plugins continue to use explicit project grants. To change the bundled implementation, rebuild Phoenix with the regenerated document.

Dashboard payloads show at most 100 projects and 300 recent conversations, prioritizing waiting and running work. The inspector reads the last 20 messages and caps working-tree patches at 192 KiB. Open the review desk for full history and branch/checkpoint comparisons. Reply drafts persist in the host client by environment and thread, independently of Workspace drafts. Git reads are cached; polling pauses while the document is hidden.
