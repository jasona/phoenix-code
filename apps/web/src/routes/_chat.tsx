import { Outlet, createFileRoute, redirect, useRouter } from "@tanstack/react-router";

import { useEffect } from "react";
import { useMissionControlStore } from "../missionControlStore";
import {
  MissionControlWorkspace,
  MissionControlWorkspaceTabs,
} from "../components/plugins/MissionControlWorkspace";

import { ThreadRouteView } from "../components/ThreadRouteView";
import { GlobalVoiceInputIndicator } from "../components/chat/GlobalVoiceInputIndicator";
import { isAppModalPage } from "../components/sidebar/mainAppLocation";
import { SidebarInset } from "../components/ui/sidebar";
import { resolveThreadRouteTarget } from "../threadRoutes";
import { retainThreadFindForRoute } from "../components/chat/threadFindStore";
import { ThreadLinkPrompt } from "../components/promptLinks/ThreadLinkPrompt";
import { useShownThreadRouteTarget } from "../hooks/useShownThreadRouteTarget";

function ChatRouteLayout() {
  // Render both routes here so draft promotion keeps the same ChatView mounted.
  const { shownTarget, modalOpen } = useShownThreadRouteTarget();
  const router = useRouter();
  const { environmentId, active, showWorkspace } = useMissionControlStore();
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Route navigation from the sidebar or a global command reveals the destination workspace.
  useEffect(
    () =>
      router.subscribe("onBeforeLoad", ({ pathChanged, fromLocation, toLocation }) => {
        const landingDraft =
          fromLocation?.pathname === "/" && toLocation.pathname.startsWith("/draft/");
        if (pathChanged && !landingDraft) showWorkspace();
      }),
    [router, showWorkspace],
  );
  return (
    <div className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      {environmentId ? <MissionControlWorkspaceTabs /> : null}
      <div
        id="workspace-panel"
        role={environmentId ? "tabpanel" : undefined}
        aria-labelledby={environmentId ? "workspace-tab" : undefined}
        hidden={active}
        className="min-h-0 flex-1 flex-col [&:not([hidden])]:flex [&>[data-slot=sidebar-inset]]:h-full"
      >
        {shownTarget?.kind === "server" && !modalOpen && !active ? (
          <ThreadLinkPrompt threadRef={shownTarget.threadRef} />
        ) : null}
        {shownTarget ? (
          <ThreadRouteView target={shownTarget} background={modalOpen || active} />
        ) : modalOpen ? (
          <SidebarInset className="h-full" />
        ) : (
          <Outlet />
        )}
        {modalOpen ? <Outlet /> : null}
      </div>
      {environmentId ? (
        <div
          id="mission-control-panel"
          role="tabpanel"
          aria-labelledby="mission-control-tab"
          hidden={!active}
          className="min-h-0 flex-1"
        >
          <MissionControlWorkspace />
        </div>
      ) : null}
      <GlobalVoiceInputIndicator hidden={modalOpen || active} />
    </div>
  );
}

export const Route = createFileRoute("/_chat")({
  beforeLoad: async ({ context, location }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
    return { appModalPage: isAppModalPage(location.pathname) };
  },
  component: ChatRouteLayout,
  // Every match carries the whole location's params, so this layout sees the thread route's too.
  onEnter: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onStay: ({ context, params }) => retainThreadFindForRouteMatch(context.appModalPage, params),
  onLeave: () => retainThreadFindForRoute({ modalPage: false, threadRef: null }),
});

function retainThreadFindForRouteMatch(
  modalPage: boolean,
  params: Partial<Record<"environmentId" | "threadId", string>>,
) {
  const target = resolveThreadRouteTarget(params);
  retainThreadFindForRoute({
    modalPage,
    threadRef: target?.kind === "server" ? target.threadRef : null,
  });
}
