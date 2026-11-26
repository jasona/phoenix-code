# Plugins

Plugins add interactive views and optional background processes to Phoenix. They run on the environment where you install them and work without a running coding agent.

## Mission Control

Mission Control is included and enabled by default. Choose its dashboard icon at the end of the sidebar’s bottom row to open the **Workspace** and **Mission Control** tabs. Workspace keeps your conversation, unsent draft, and right panel; Mission Control spans all projects and threads in the environment. Switching tabs preserves both views. Choose the icon again, or close the Mission Control tab, to return to the single-workspace layout.

You can also open it from **Settings → Plugins → Mission Control** or the command palette. If you connect to multiple environments, select one within Mission Control; switching conversations does not change that selection. On native mobile, open it from the conversation header’s **Plugins** menu.

The **Inbox** opens first and groups decisions, failures, and results ready for review. Reading a result does not accept it. Use **Accept work** after reviewing, or **Snooze 1 hour** to return later; the Accepted and Snoozed views let you restore work, and Undo reverses your latest inbox action. Blocking approvals stay visible.

Select a thread for its recent activity and **Evidence**. Agent completion, command outcomes, your acceptance, and shipping evidence are separate. Recorded commands show their output and exit status; they do not automatically prove that all checks passed against the current files. Later recorded file edits mark evidence stale, and missing revision or shipping evidence stays unverified.

On web and desktop, **Review work** opens a review desk inside Mission Control with the full conversation, approval and question controls, branch and checkpoint diffs, inline review comments, file context, terminal, and preview. **Back to inbox** returns to the preserved queue. Native mobile opens the conversation's existing controls. Overview, Board, Timeline, and Graph remain available for browsing all projects; **Usage** shows limits reported by your configured providers.

Use **New Thread** to choose a project, model, and prompt. The project default is used when no model is selected; new threads start with approval required. Replies use the conversation’s current model and permissions. During supported runs, choose whether to queue a reply or steer the current run. Stop, retry, and resume appear when supported for that run. Scheduled tasks appear on the Timeline and Board.

Unsent Mission Control replies are saved separately for each thread on this device. They survive switching threads, closing Mission Control, and reloading Phoenix. Sending clears only the draft that was sent; newer typing and other threads' drafts remain. Drafts are separate from the Workspace composer and are not synced between devices.

Mission Control works through the normal Phoenix connection, including remote environments. No separate installation, Node process, or local port is required. You can disable it in Settings; that choice survives restarts and updates. Bundled plugins cannot be uninstalled.

## Try Project Board

1. Open **Settings → Plugins** and choose the environment that owns your workspace.
2. Enter the absolute path to `examples/plugins/project-board` in your Phoenix checkout on that environment, then choose **Install plugin**.
3. Choose **Enable**. Enable only code you trust: plugin processes run with the server user's permissions.
4. Expand **Project permissions** and select your project. The example requests conversation context and permission to attach task text. You can turn individual capabilities off.
5. Open a conversation, open its right panel, and choose **Plugins → Project Board**. The command palette's **Open plugins** action also opens the plugin list.
6. Add a task. **Attach to conversation** copies a task into that conversation's draft; it does not send a message.

Tasks are saved by project. Switching conversations does not retarget an open view. **Project overview** opens a full-page board: choose a project, then optionally choose a conversation to use conversation actions.

For background completion tracking, choose **Use for background work** beside an allowed project. The example records future thread completions even while its tab is closed. **Stop background events** clears this selection. Background notifications are best-effort; they do not replay completions missed while the environment was stopped.

On mobile, open **Plugins** from the conversation header. Installation, configuration, permissions, and logs are managed from Settings on web or desktop.

## Manage execution and permissions

Closing or hiding a conversation’s plugin view unloads its UI and releases its subscriptions and temporary model context. The global Mission Control tab stays mounted when you switch to Workspace and pauses dashboard polling; closing its tab unloads it. It leaves enabled background work running. Reopen the view from the plugin list or the closed-view history.

**Restart** restarts the plugin's processes without deleting its data. Reopen views afterward. **View logs** shows recent process output. **Refresh** updates process status. A repeatedly crashing sidecar stops retrying; inspect its logs, fix the problem, then restart it.

**Disable** stops execution and refuses further requests. **Uninstall** removes the registration and keeps saved data. Reinstalling the same plugin ID can reuse that data; reinstalling resets enablement, permissions, and configuration.

Permissions apply to the selected projects and requested capabilities. Changing permissions invalidates existing views. Plugins must ask separately for transcripts, files, attaching text, sending messages, creating conversations, and contributing model context. Sending a message or creating a conversation from a third-party view also asks for confirmation. Mission Control’s built-in composer sends the message you submit directly.

After an environment restart or a stale-view notice, choose **Retry**. Phoenix does not automatically replay a failed write.

## Build a plugin

See the [Project Board authoring guide](../../examples/plugins/project-board/README.md) for the package format, SDK, and development commands. You can build and install plugins without editing Phoenix itself.

Remote clients use the owning environment's normal authenticated connection. They do not need to reach a plugin's local port. Servers without plugin support show an update notice; existing conversations continue working.
