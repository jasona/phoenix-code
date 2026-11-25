# Plugins

Plugins add interactive views and optional background processes to Phoenix. They run on the environment where you install them and work without a running coding agent.

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

Closing or hiding a view unloads its UI and releases its subscriptions and temporary model context. It leaves enabled background work running. Reopen the view from the plugin list or the closed-view history.

**Restart** restarts the plugin's processes without deleting its data. Reopen views afterward. **View logs** shows recent process output. **Refresh** updates process status. A repeatedly crashing sidecar stops retrying; inspect its logs, fix the problem, then restart it.

**Disable** stops execution and refuses further requests. **Uninstall** removes the registration and keeps saved data. Reinstalling the same plugin ID can reuse that data; reinstalling resets enablement, permissions, and configuration.

Permissions apply to the selected projects and requested capabilities. Changing permissions invalidates existing views. Plugins must ask separately for transcripts, files, attaching text, sending messages, creating conversations, and contributing model context. Sending a message or creating a conversation from a view also asks for confirmation.

After an environment restart or a stale-view notice, choose **Retry**. Phoenix does not automatically replay a failed write.

## Build a plugin

See the [Project Board authoring guide](../../examples/plugins/project-board/README.md) for the package format, SDK, and development commands. You can build and install plugins without editing Phoenix itself.

Remote clients use the owning environment's normal authenticated connection. They do not need to reach a plugin's local port. Servers without plugin support show an update notice; existing conversations continue working.
