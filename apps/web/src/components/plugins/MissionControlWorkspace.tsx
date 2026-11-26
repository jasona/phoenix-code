import { LayoutDashboardIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { useGT } from "gt-react";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { ScopedProjectRef } from "@t3tools/contracts";
import { useMissionControlStore } from "../../missionControlStore";
import { useMissionControlNewThread } from "../../hooks/useMissionControlNewThread";
import { readLastUsedProjectKey } from "../../hooks/useHandleNewThread";
import { useProjects } from "../../state/entities";
import { useEnvironments } from "../../state/environments";
import { cn } from "../../lib/utils";
import { isElectron } from "../../env";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { Button } from "../ui/button";
import { PluginView } from "./PluginPanel";
import { MissionControlThreadWindows } from "./MissionControlThreadWindows";

export function MissionControlWorkspaceTabs() {
  const gt = useGT();
  const active = useMissionControlStore((state) => state.active);
  const { showWorkspace, showMissionControl, close } = useMissionControlStore();
  return (
    <WorkspacePageHeader electron={isElectron} className="border-b border-border bg-background">
      <div
        role="tablist"
        aria-label={gt("Workspace")}
        className="flex h-full min-w-0 items-stretch gap-1 [-webkit-app-region:no-drag]"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? false : event.key === "End" ? true : !active;
          if (next) showMissionControl();
          else showWorkspace();
          const tabs = event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]');
          tabs[next ? 1 : 0]?.focus();
        }}
      >
        {[
          {
            id: "workspace",
            label: gt("Workspace"),
            icon: MessageSquareIcon,
            selected: !active,
            onClick: showWorkspace,
          },
          {
            id: "mission-control",
            // oxlint-disable-next-line t3code/no-untranslated-copy -- Mission Control is the bundled plugin’s product name.
            label: "Mission Control",
            icon: LayoutDashboardIcon,
            selected: active,
            onClick: showMissionControl,
          },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${tab.id}-tab`}
            aria-controls={`${tab.id}-panel`}
            aria-selected={tab.selected}
            tabIndex={tab.selected ? 0 : -1}
            onClick={tab.onClick}
            className={cn(
              "flex min-w-0 items-center gap-2 border-b-2 px-3 text-sm focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring",
              tab.selected
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            <tab.icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{tab.label}</span>
          </button>
        ))}
      </div>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={gt("Close {name}", { name: "Mission Control" })}
        onClick={close}
      >
        <XIcon aria-hidden />
      </Button>
    </WorkspacePageHeader>
  );
}

export function MissionControlWorkspace() {
  const gt = useGT();
  const { environmentId, active, open, inspectThread } = useMissionControlStore();
  const { environments } = useEnvironments();
  const projects = useProjects();
  const openDraft = useMissionControlNewThread();
  const newThread = async (requested: ScopedProjectRef | null, instanceId: string) => {
    const candidates = projects.filter(
      (project) => project.environmentId === environmentId && project.archivedAt == null,
    );
    const lastUsed = readLastUsedProjectKey();
    const project = requested
      ? candidates.find((item) => item.id === requested.projectId)
      : (candidates.find(
          (item) => scopedProjectKey(scopeProjectRef(item.environmentId, item.id)) === lastUsed,
        ) ?? candidates[0]);
    if (!project) throw new Error(gt("Add a project to start your first thread."));
    await openDraft(scopeProjectRef(project.environmentId, project.id), instanceId);
  };
  if (!environmentId) return null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {environments.length > 1 && (
        <div
          className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2"
          aria-label={gt("Environments")}
        >
          {environments.map((environment) => (
            <Button
              key={environment.environmentId}
              size="sm"
              variant={environment.environmentId === environmentId ? "secondary" : "ghost"}
              onClick={() => open(environment.environmentId)}
            >
              {environment.label}
            </Button>
          ))}
        </div>
      )}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <PluginView
          key={environmentId}
          environmentId={environmentId}
          pluginId="mission-control"
          viewId="dashboard"
          active={active}
          onInspectThread={inspectThread}
          onNewThread={newThread}
        />
        <MissionControlThreadWindows active={active} />
      </div>
    </div>
  );
}
