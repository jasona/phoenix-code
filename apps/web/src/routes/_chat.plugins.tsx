import { createFileRoute } from "@tanstack/react-router";
import { useGT } from "gt-react";
import { useOpenMissionControl } from "../hooks/useOpenMissionControl";
import { useEffect, useState } from "react";
import { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { PluginView } from "../components/plugins/PluginPanel";
import { useProjects, useThreadShells } from "../state/entities";
import { Button } from "../components/ui/button";
import { useEnvironmentQuery } from "../state/query";
import { mcpAppEnvironment } from "../state/mcpApps";

function PluginWorkspace() {
  const gt = useGT();
  const search = Route.useSearch();
  if (!search.environmentId || !search.pluginId || !search.viewId)
    return <p className="p-5">{gt("Open a plugin from Settings or a conversation.")}</p>;
  if (search.pluginId === "mission-control" && search.viewId === "dashboard")
    return <OpenMissionControl environmentId={search.environmentId} />;
  return <PluginWorkspaceContent environmentId={search.environmentId} />;
}
function OpenMissionControl({ environmentId }: { environmentId: EnvironmentId }) {
  const open = useOpenMissionControl();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Legacy plugin URLs enter the global workspace through the same navigation as Settings.
  useEffect(() => {
    void open(environmentId);
  }, [environmentId, open]);
  return null;
}
function PluginWorkspaceContent({ environmentId }: { environmentId: EnvironmentId }) {
  const gt = useGT();
  const search = Route.useSearch();
  const projects = useProjects().filter((project) => project.environmentId === environmentId);
  const threads = useThreadShells().filter((thread) => thread.environmentId === environmentId);
  const [projectId, setProjectId] = useState<string>(search.projectId ?? "");
  const [threadId, setThreadId] = useState<string | null>(null);
  const listing = useEnvironmentQuery(
    mcpAppEnvironment.pluginsListQuery({ environmentId, input: {} }),
  );
  const view = listing.data
    ?.find((entry) => entry.manifest.id === search.pluginId)
    ?.manifest.views.find((view) => view.id === search.viewId);
  const thread = threads.find((thread) => thread.id === threadId);
  return (
    <section className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <h1 className="font-semibold">{view?.title ?? gt("Plugin")}</h1>
        <Button variant="ghost" onClick={() => window.history.back()}>
          {gt("Back")}
        </Button>
        {projectId && view?.scope !== "environment" && (
          <Button
            variant="ghost"
            onClick={() => {
              setProjectId("");
              setThreadId(null);
            }}
          >
            {gt("Change project")}
          </Button>
        )}
      </div>
      {projectId && view?.scope === "project" && (
        <details className="border-b border-border p-3">
          <summary>{thread?.title ?? gt("Choose a conversation for conversation actions")}</summary>
          <div className="flex flex-wrap gap-2 pt-2">
            <Button variant="ghost" onClick={() => setThreadId(null)}>
              {gt("Project only")}
            </Button>
            {threads
              .filter((thread) => thread.projectId === projectId)
              .map((thread) => (
                <Button key={thread.id} variant="outline" onClick={() => setThreadId(thread.id)}>
                  {thread.title}
                </Button>
              ))}
          </div>
        </details>
      )}
      {view?.scope === "environment" ? (
        <div className="min-h-0 flex-1">
          <PluginView
            environmentId={environmentId}
            pluginId={search.pluginId}
            viewId={search.viewId}
          />
        </div>
      ) : !projectId ? (
        <div className="space-y-3 p-5">
          <p>{gt("Choose a project for this plugin view.")}</p>
          {projects.map((project) => (
            <Button key={project.id} variant="outline" onClick={() => setProjectId(project.id)}>
              {project.title}
            </Button>
          ))}
        </div>
      ) : !thread && (view?.scope ?? "thread") === "thread" ? (
        <div className="space-y-3 p-5">
          <p>{gt("Choose a conversation for this plugin view.")}</p>
          {threads
            .filter((thread) => thread.projectId === projectId)
            .map((thread) => (
              <Button key={thread.id} variant="outline" onClick={() => setThreadId(thread.id)}>
                {thread.title}
              </Button>
            ))}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <PluginView
            key={`${projectId}:${threadId}`}
            pluginId={search.pluginId}
            viewId={search.viewId}
            projectRef={{ environmentId, projectId: ProjectId.make(projectId) }}
            {...(thread ? { threadRef: { environmentId, threadId: thread.id } } : {})}
          />
        </div>
      )}
    </section>
  );
}
export const Route = createFileRoute("/_chat/plugins")({
  validateSearch: (search: Record<string, unknown>) => ({
    ...(typeof search.environmentId === "string" && search.environmentId.trim()
      ? { environmentId: EnvironmentId.make(search.environmentId) }
      : {}),
    pluginId: typeof search.pluginId === "string" ? search.pluginId : "",
    viewId: typeof search.viewId === "string" ? search.viewId : "",
    ...(typeof search.projectId === "string" && search.projectId.trim()
      ? { projectId: ProjectId.make(search.projectId) }
      : {}),
  }),
  component: PluginWorkspace,
});
