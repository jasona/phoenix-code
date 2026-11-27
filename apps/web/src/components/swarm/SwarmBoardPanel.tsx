import {
  countSwarmMembers,
  deriveSwarmWorkstreams,
  filterSwarmMessages,
  groupSwarmMessages,
  parseSwarmMessageSegments,
  sortSwarmMembers,
} from "@t3tools/client-runtime/swarm-board";
import type { ScopedThreadRef, SwarmMember, SwarmMessage, SwarmSnapshot } from "@t3tools/contracts";
import { T, useGT } from "gt-react";
import {
  AlertTriangle,
  ArrowDown,
  Brain,
  ChevronRight,
  Filter,
  Network,
  RefreshCw,
  Search,
  Wrench,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";
import { orchestrationEnvironment } from "~/state/orchestration";
import { useAtomCommand } from "~/state/use-atom-command";
import { SwarmMemberTranscriptView } from "./SwarmMemberTranscriptView";

type SwarmTabId = "overview" | "board" | "members";

const POLL_ACTIVE_MS = 2_500;
const POLL_EMPTY_MS = 4_000;
const INITIAL_TAIL = 200;
const MAX_TAIL = 500;
const COLLAPSE_CHAR_LIMIT = 520;
const COLLAPSE_LINE_LIMIT = 10;

function StatusDot(props: { readonly status: SwarmMember["status"] }) {
  if (props.status === "working") {
    return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full bg-success" />;
  }
  if (props.status === "waiting") {
    return (
      <span
        aria-hidden
        className="inline-block size-2 shrink-0 rounded-full border border-muted-foreground/70 bg-transparent"
      />
    );
  }
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full bg-muted-foreground/35"
    />
  );
}

function formatShortTime(raw: string): string {
  if (!raw) return "";
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return raw;
  const now = new Date();
  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return sameDay
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

function isLongPost(text: string): boolean {
  if (text.length > COLLAPSE_CHAR_LIMIT) return true;
  let lines = 1;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) {
      lines += 1;
      if (lines > COLLAPSE_LINE_LIMIT) return true;
    }
  }
  return false;
}

export function SwarmBoardPanel(props: {
  readonly threadRef: ScopedThreadRef;
  readonly visible: boolean;
  readonly supported: boolean;
}) {
  const gt = useGT();
  const readSwarmBoard = useAtomCommand(orchestrationEnvironment.swarmBoardRead, {
    reportFailure: false,
  });

  const [snapshot, setSnapshot] = useState<SwarmSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tail, setTail] = useState(INITIAL_TAIL);
  const [manualTab, setManualTab] = useState<SwarmTabId | null>(null);
  const [inspectedMemberName, setInspectedMemberName] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [fromAgent, setFromAgent] = useState("");
  const [toMember, setToMember] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("");
  const [hiddenAgents, setHiddenAgents] = useState<ReadonlySet<string>>(() => new Set());
  const [follow, setFollow] = useState(true);
  const [showKilled, setShowKilled] = useState(false);
  const [expandedSeqs, setExpandedSeqs] = useState<ReadonlySet<number>>(() => new Set());
  const [highlightedSeq, setHighlightedSeq] = useState<number | null>(null);

  const etagRef = useRef<string | undefined>(undefined);
  const inFlightRef = useRef(false);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const tailRef = useRef(tail);

  const pollSnapshot = useStableCallback(async (forceFull: boolean) => {
    if (!props.supported || inFlightRef.current) return;
    inFlightRef.current = true;
    if (forceFull) setRefreshing(true);
    const result = await readSwarmBoard({
      environmentId: props.threadRef.environmentId,
      input: {
        threadId: props.threadRef.threadId,
        tail: tailRef.current,
        ...(!forceFull && etagRef.current ? { etag: etagRef.current } : {}),
      },
    });
    inFlightRef.current = false;
    setRefreshing(false);
    setLoaded(true);
    if (result._tag !== "Success") {
      setErrorText(gt("Could not load the swarm board."));
      return;
    }
    setErrorText(null);
    if (result.value.unchanged) return;
    etagRef.current = result.value.etag;
    setSnapshot(result.value.swarm);
  });

  const hasSwarm = snapshot !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the thread's on-disk swarm state via etag while the panel is visible
  useEffect(() => {
    if (!props.visible || !props.supported) return;
    etagRef.current = undefined;
    void pollSnapshot(false);
    const intervalMs = hasSwarm ? POLL_ACTIVE_MS : POLL_EMPTY_MS;
    const timer = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void pollSnapshot(false);
    }, intervalMs);
    return () => {
      clearInterval(timer);
    };
  }, [props.visible, props.supported, hasSwarm, pollSnapshot]);

  const hasOverviewContent =
    snapshot !== null && (snapshot.plan !== null || snapshot.systemAttention.length > 0);
  const activeTab: SwarmTabId = manualTab ?? (hasOverviewContent ? "overview" : "board");

  const filteredMessages = snapshot
    ? filterSwarmMessages(snapshot.messages, {
        search,
        fromAgent,
        toMember,
        channel: selectedChannel,
        hiddenAgents,
      })
    : [];

  const scrollFeedKey = `${snapshot?.head ?? 0}:${filteredMessages.length}`;
  const lastScrolledKeyRef = useRef("");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the board feed pinned to the newest post while Follow is enabled
  useEffect(() => {
    if (activeTab !== "board" || !follow || !feedRef.current) return;
    if (lastScrolledKeyRef.current === scrollFeedKey && feedRef.current.scrollTop > 0) return;
    lastScrolledKeyRef.current = scrollFeedKey;
    feedRef.current.scrollTop = feedRef.current.scrollHeight;
  }, [activeTab, follow, scrollFeedKey]);

  const inspectedMember =
    inspectedMemberName && snapshot
      ? (snapshot.members.find((candidate) => candidate.name === inspectedMemberName) ?? null)
      : null;

  if (!props.supported) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <p className="max-w-xs text-muted-foreground text-sm">
          <T>Update this environment’s Phoenix server to view the Swarm board.</T>
        </p>
      </div>
    );
  }

  if (inspectedMember) {
    return (
      <SwarmMemberTranscriptView
        environmentId={props.threadRef.environmentId}
        threadId={props.threadRef.threadId}
        member={inspectedMember}
        onBack={() => setInspectedMemberName(null)}
      />
    );
  }

  if (!loaded && snapshot === null) {
    return (
      <div className="flex h-full items-center justify-center p-6">
        <p className="text-muted-foreground text-sm">
          <T>Looking for this conversation’s swarm…</T>
        </p>
      </div>
    );
  }

  if (snapshot === null) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <Network className="size-5" />
        </div>
        <div className="space-y-1">
          <h2 className="font-medium text-foreground text-sm">
            <T>No swarm in this conversation</T>
          </h2>
          <p className="max-w-xs text-muted-foreground text-xs">
            <T>
              Start a native Antigravity swarm with <code>/swarm</code> and this panel will update
              automatically.
            </T>
          </p>
        </div>
        {errorText ? <p className="text-destructive-foreground text-xs">{errorText}</p> : null}
        <Button
          size="xs"
          variant="outline"
          disabled={refreshing}
          onClick={() => void pollSnapshot(true)}
        >
          <RefreshCw className="size-3" />
          <T>Refresh</T>
        </Button>
      </div>
    );
  }

  const counts = countSwarmMembers(snapshot.members);
  const sortedMembers = sortSwarmMembers(snapshot.members);
  const killedMembers = sortedMembers.filter((member) => member.killed);
  const visibleMembers = showKilled
    ? sortedMembers
    : sortedMembers.filter((member) => !member.killed);
  const messageGroups = groupSwarmMessages(filteredMessages, snapshot.member);
  const lastPostTime = snapshot.messages[snapshot.messages.length - 1]?.time ?? "";
  const activeFilterCount =
    (fromAgent ? 1 : 0) + (toMember ? 1 : 0) + (selectedChannel ? 1 : 0) + hiddenAgents.size;

  const tabs: ReadonlyArray<{
    readonly id: SwarmTabId;
    readonly label: string;
    readonly count?: number;
    readonly alertCount?: number;
  }> = [
    {
      id: "overview",
      label: gt("Overview"),
      ...(snapshot.systemAttention.length > 0
        ? { alertCount: snapshot.systemAttention.length }
        : {}),
    },
    { id: "board", label: gt("Board"), count: snapshot.totalMessages },
    { id: "members", label: gt("Members"), count: counts.total },
  ];

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === activeTab);
    if (currentIndex < 0) return;
    let nextIndex = -1;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % tabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = tabs.length - 1;
    if (nextIndex < 0) return;
    event.preventDefault();
    const nextTab = tabs[nextIndex];
    if (nextTab) setManualTab(nextTab.id);
  };

  const jumpToSeq = (seq: number) => {
    setManualTab("board");
    setFollow(false);
    setHighlightedSeq(seq);
    requestAnimationFrame(() => {
      const target = feedRef.current?.querySelector<HTMLElement>(`[data-swarm-seq="${seq}"]`);
      if (!target) return;
      const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
    });
  };

  const toggleHiddenAgent = (agent: string) => {
    setHiddenAgents((current) => {
      const next = new Set(current);
      if (next.has(agent)) next.delete(agent);
      else next.add(agent);
      return next;
    });
  };

  const clearFilters = () => {
    setSearch("");
    setFromAgent("");
    setToMember("");
    setSelectedChannel("");
    setHiddenAgents(new Set());
  };

  const toggleExpandSeq = (seq: number) => {
    setExpandedSeqs((current) => {
      const next = new Set(current);
      if (next.has(seq)) next.delete(seq);
      else next.add(seq);
      return next;
    });
  };

  const handleFeedScroll = () => {
    const element = feedRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    if (distanceFromBottom > 48 && follow) {
      setFollow(false);
    } else if (distanceFromBottom <= 16 && !follow) {
      setFollow(true);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="swarm-board-panel">
      <header className="shrink-0 border-b border-border px-4 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h2
              className="truncate font-semibold text-foreground text-sm"
              data-testid="swarm-title"
            >
              {snapshot.title}
            </h2>
            <p className="mt-0.5 truncate text-muted-foreground text-xs" data-testid="swarm-meta">
              {gt("{active} active · {waiting} waiting", {
                active: counts.active,
                waiting: counts.waiting,
              })}
              {counts.killed > 0 ? ` · ${gt("{killed} killed", { killed: counts.killed })}` : ""}
              {lastPostTime ? ` · ${formatShortTime(lastPostTime)}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Badge size="sm" variant={counts.active > 0 ? "success" : "secondary"}>
              <span
                aria-hidden
                className={cn(
                  "inline-block size-1.5 rounded-full",
                  counts.active > 0 ? "bg-success" : "bg-muted-foreground/50",
                )}
              />
              {counts.active > 0 ? <T>Live</T> : <T>Idle</T>}
            </Badge>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={gt("Refresh swarm board")}
              disabled={refreshing}
              onClick={() => void pollSnapshot(true)}
            >
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>

        <div
          role="tablist"
          aria-label={gt("Swarm views")}
          onKeyDown={handleTabKeyDown}
          className="mt-2.5 flex items-center gap-4"
        >
          {tabs.map((tab) => {
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                data-testid={`swarm-tab-${tab.id}`}
                onClick={() => setManualTab(tab.id)}
                className={cn(
                  "relative inline-flex cursor-pointer items-center gap-1.5 pb-2 font-medium text-xs outline-none transition-colors focus-visible:text-foreground",
                  selected
                    ? "text-foreground after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <span>{tab.label}</span>
                {tab.count !== undefined ? (
                  <span className="font-mono text-2xs text-muted-foreground">{tab.count}</span>
                ) : null}
                {tab.alertCount !== undefined ? (
                  <Badge size="sm" variant="warning">
                    {tab.alertCount}
                  </Badge>
                ) : null}
              </button>
            );
          })}
        </div>
      </header>

      {errorText ? (
        <div className="shrink-0 border-b border-destructive/20 bg-destructive/10 px-4 py-1.5 text-destructive-foreground text-xs">
          {errorText}
        </div>
      ) : null}

      {activeTab === "overview" ? (
        <SwarmOverviewTab
          snapshot={snapshot}
          onInspectMember={setInspectedMemberName}
          onOpenBoard={() => setManualTab("board")}
        />
      ) : null}

      {activeTab === "board" ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
            <div className="flex items-center gap-1.5">
              <div className="flex min-w-0 flex-1 items-center gap-1.5">
                <Search className="size-3.5 shrink-0 text-muted-foreground" />
                <Input
                  size="sm"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={gt("Search posts…")}
                  aria-label={gt("Search swarm posts")}
                  data-testid="swarm-search"
                />
              </div>
              <Button
                size="sm"
                variant={filtersOpen || activeFilterCount > 0 ? "secondary" : "ghost"}
                aria-expanded={filtersOpen}
                aria-label={gt("Toggle board filters")}
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <Filter className="size-3.5" />
                {activeFilterCount > 0 ? (
                  <span className="font-mono text-2xs">{activeFilterCount}</span>
                ) : null}
              </Button>
              <label className="inline-flex cursor-pointer items-center gap-1.5 ps-1 text-muted-foreground text-xs">
                <Switch checked={follow} onCheckedChange={setFollow} />
                <span>
                  <T>Follow</T>
                </span>
              </label>
            </div>

            {snapshot.channels.length > 0 ? (
              <div
                className="flex flex-wrap items-center gap-1"
                role="tablist"
                aria-label={gt("Channels")}
              >
                <button
                  type="button"
                  onClick={() => setSelectedChannel("")}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-0.5 text-xs transition-colors",
                    selectedChannel === ""
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  <T>All</T>
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedChannel("main")}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-0.5 font-mono text-xs transition-colors",
                    selectedChannel === "main"
                      ? "bg-accent font-medium text-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  #main
                </button>
                {snapshot.channels.map((channel) => (
                  <button
                    key={channel.name}
                    type="button"
                    onClick={() => setSelectedChannel(channel.name)}
                    className={cn(
                      "cursor-pointer rounded-md px-2 py-0.5 font-mono text-xs transition-colors",
                      selectedChannel === channel.name
                        ? "bg-accent font-medium text-foreground"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                      channel.archived && "opacity-60",
                    )}
                  >
                    {`#${channel.name}`}
                  </button>
                ))}
              </div>
            ) : null}

            {filtersOpen ? (
              <div className="space-y-2 rounded-md border border-border bg-muted/30 p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <Select
                    value={fromAgent || "__all__"}
                    onValueChange={(value) =>
                      setFromAgent(value === "__all__" ? "" : (value ?? ""))
                    }
                  >
                    <SelectTrigger size="xs" aria-label={gt("Filter by poster")}>
                      <SelectValue placeholder={gt("From anyone")} />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="__all__">
                        <T>From anyone</T>
                      </SelectItem>
                      {sortedMembers.map((member) => (
                        <SelectItem key={member.name} value={member.name}>
                          {member.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>

                  <Select
                    value={toMember || "__all__"}
                    onValueChange={(value) => setToMember(value === "__all__" ? "" : (value ?? ""))}
                  >
                    <SelectTrigger size="xs" aria-label={gt("Filter by recipient")}>
                      <SelectValue placeholder={gt("To anyone")} />
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="__all__">
                        <T>To anyone</T>
                      </SelectItem>
                      {sortedMembers.map((member) => (
                        <SelectItem key={member.name} value={member.name}>
                          {`@${member.name}`}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>

                <div className="flex flex-wrap items-center gap-1">
                  {sortedMembers.map((member) => {
                    const hidden = hiddenAgents.has(member.name);
                    return (
                      <button
                        key={member.name}
                        type="button"
                        onClick={() => toggleHiddenAgent(member.name)}
                        className={cn(
                          "inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-2xs transition-colors",
                          hidden
                            ? "border-border bg-transparent text-muted-foreground/60 line-through"
                            : "border-border bg-background text-foreground hover:bg-accent/50",
                        )}
                      >
                        <StatusDot status={member.status} />
                        <span>{member.name}</span>
                      </button>
                    );
                  })}
                  {activeFilterCount > 0 || search.trim() ? (
                    <Button size="xs" variant="ghost" onClick={clearFilters}>
                      <T>Clear filters</T>
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div
            ref={feedRef}
            onScroll={handleFeedScroll}
            className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
            data-testid="swarm-feed"
          >
            {snapshot.messagesOffset > 0 ? (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-1.5 text-muted-foreground text-xs">
                <span>
                  {gt("Showing newest {shown} of {total} posts", {
                    shown: snapshot.messages.length,
                    total: snapshot.totalMessages,
                  })}
                </span>
                {tail < MAX_TAIL ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={() => {
                      const nextTail = Math.min(MAX_TAIL, tail + 150);
                      tailRef.current = nextTail;
                      setTail(nextTail);
                      etagRef.current = undefined;
                      void pollSnapshot(true);
                    }}
                  >
                    <T>Load earlier</T>
                  </Button>
                ) : null}
              </div>
            ) : null}

            {messageGroups.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
                <p className="text-muted-foreground text-sm">
                  {snapshot.totalMessages === 0 ? (
                    <T>No board posts yet.</T>
                  ) : (
                    <T>No posts match the current filters.</T>
                  )}
                </p>
                {activeFilterCount > 0 || search.trim() ? (
                  <Button size="xs" variant="outline" onClick={clearFilters}>
                    <T>Clear filters</T>
                  </Button>
                ) : null}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {messageGroups.map((group) => {
                  const firstMessage = group.messages[0];
                  const showGroupUnreadDivider =
                    snapshot.firstUnreadSeq > 0 &&
                    firstMessage !== undefined &&
                    firstMessage.seq === snapshot.firstUnreadSeq;
                  return (
                    <div key={group.id} className="flex flex-col gap-2">
                      {showGroupUnreadDivider ? (
                        <div className="my-1 flex items-center gap-2 font-medium text-2xs text-primary">
                          <span className="h-px flex-1 bg-primary/40" />
                          <span>
                            <T>New</T>
                          </span>
                          <span className="h-px flex-1 bg-primary/40" />
                        </div>
                      ) : null}
                      <div
                        className={cn(
                          "flex flex-col gap-2",
                          group.mentionsSelf && "border-l-2 border-primary pl-2.5",
                        )}
                      >
                        {group.messages.map((message, index) => {
                          const previous = index > 0 ? group.messages[index - 1] : undefined;
                          const prevRecipientKey = previous
                            ? `${previous.channel ?? ""}|${previous.all ? "*" : ""}|${previous.mentions.join(",")}`
                            : "";
                          const curRecipientKey = `${message.channel ?? ""}|${message.all ? "*" : ""}|${message.mentions.join(",")}`;
                          return (
                            <SwarmMessageRow
                              key={message.seq}
                              message={message}
                              isGroupStart={index === 0}
                              recipientsChanged={index > 0 && curRecipientKey !== prevRecipientKey}
                              showUnreadDivider={
                                index > 0 &&
                                snapshot.firstUnreadSeq > 0 &&
                                message.seq === snapshot.firstUnreadSeq
                              }
                              highlighted={highlightedSeq === message.seq}
                              expanded={expandedSeqs.has(message.seq)}
                              headSeq={snapshot.head}
                              selfMember={snapshot.member}
                              onToggleExpand={() => toggleExpandSeq(message.seq)}
                              onJumpToSeq={jumpToSeq}
                              onInspectAgent={() => {
                                if (
                                  snapshot.members.some((member) => member.name === message.agent)
                                ) {
                                  setInspectedMemberName(message.agent);
                                }
                              }}
                            />
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {!follow && filteredMessages.length > 0 ? (
            <div className="pointer-events-none absolute right-4 bottom-3">
              <Button
                size="xs"
                variant="secondary"
                className="pointer-events-auto"
                onClick={() => {
                  setFollow(true);
                  if (feedRef.current) {
                    feedRef.current.scrollTop = feedRef.current.scrollHeight;
                  }
                }}
              >
                <ArrowDown className="size-3" />
                <T>Latest</T>
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      {activeTab === "members" ? (
        <div className="flex min-h-0 flex-1 flex-col">
          {killedMembers.length > 0 ? (
            <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2 text-muted-foreground text-xs">
              <span>
                {gt("{active} active · {waiting} waiting", {
                  active: counts.active,
                  waiting: counts.waiting,
                })}
              </span>
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <Switch checked={showKilled} onCheckedChange={setShowKilled} />
                <span>{gt("Show killed ({count})", { count: killedMembers.length })}</span>
              </label>
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2" data-testid="swarm-members">
            <div className="flex flex-col gap-1.5">
              {visibleMembers.map((member) => (
                <SwarmMemberRow
                  key={member.name}
                  member={member}
                  isSelf={member.name === snapshot.member}
                  taskSummary={snapshot.plan?.tasks[member.name] ?? ""}
                  onInspect={() => setInspectedMemberName(member.name)}
                />
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SwarmOverviewTab(props: {
  readonly snapshot: SwarmSnapshot;
  readonly onInspectMember: (name: string) => void;
  readonly onOpenBoard: () => void;
}) {
  const gt = useGT();
  const { snapshot } = props;
  const { workstreams, unassignedMembers } = deriveSwarmWorkstreams(snapshot);
  const activeUnassignedMembers = unassignedMembers.filter((member) => !member.killed);
  const recentPosts = snapshot.messages
    .filter((message) => !message.control)
    .slice(-4)
    .reverse();

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" data-testid="swarm-overview">
      <div className="flex flex-col gap-4">
        {snapshot.systemAttention.length > 0 ? (
          <section className="flex flex-col gap-1.5" aria-label={gt("System alerts")}>
            {snapshot.systemAttention.map((alert) => (
              <div
                key={alert.id}
                className="flex items-start justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs"
              >
                <div className="flex min-w-0 items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning-foreground" />
                  <div className="min-w-0">
                    <p className="font-medium text-foreground">{alert.text}</p>
                    {alert.detail ? (
                      <p className="mt-0.5 truncate text-muted-foreground">{alert.detail}</p>
                    ) : null}
                  </div>
                </div>
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={() => props.onInspectMember(alert.member)}
                >
                  <T>Inspect</T>
                </Button>
              </div>
            ))}
          </section>
        ) : null}

        {snapshot.plan?.goal ? (
          <section className="rounded-lg border border-border bg-card px-3.5 py-3">
            <h3 className="font-medium text-foreground text-sm">{snapshot.plan.goal.title}</h3>
            {snapshot.plan.goal.line ? (
              <p className="mt-1 text-muted-foreground text-xs">{snapshot.plan.goal.line}</p>
            ) : null}
          </section>
        ) : null}

        {workstreams.length > 0 ? (
          <section className="flex flex-col gap-2.5">
            <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              <T>Workstreams</T>
            </h3>
            {workstreams.map((workstream) => (
              <div key={workstream.id} className="rounded-lg border border-border bg-card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h4 className="font-medium text-foreground text-sm">{workstream.title}</h4>
                    {workstream.goal ? (
                      <p className="mt-0.5 text-muted-foreground text-xs">{workstream.goal}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {workstream.activeCount > 0 ? (
                      <Badge size="sm" variant="success">
                        {gt("{count} active", { count: workstream.activeCount })}
                      </Badge>
                    ) : (
                      <Badge size="sm" variant="secondary">
                        <T>Idle</T>
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="mt-2.5 flex flex-col divide-y divide-border/60">
                  {workstream.members.map((entry) => (
                    <button
                      key={entry.name}
                      type="button"
                      disabled={entry.member === null}
                      onClick={() => {
                        if (entry.member) props.onInspectMember(entry.name);
                      }}
                      className="flex w-full cursor-pointer items-start gap-2 py-2 text-left transition-colors first:pt-0 last:pb-0 hover:text-foreground disabled:cursor-default disabled:opacity-60"
                    >
                      <span className="mt-1">
                        <StatusDot status={entry.member?.status ?? "waiting"} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground text-xs">{entry.name}</span>
                          {entry.member?.roleWorker && entry.member.role !== entry.name ? (
                            <Badge size="sm" variant="outline">
                              {entry.member.role}
                            </Badge>
                          ) : null}
                        </div>
                        {entry.task ? (
                          <p className="mt-0.5 text-muted-foreground text-xs">{entry.task}</p>
                        ) : null}
                        {entry.member?.activity ? (
                          <p className="mt-1 flex items-center gap-1 truncate font-mono text-2xs text-foreground/80">
                            {entry.member.activityKind === "tool" ? (
                              <Wrench className="size-3 shrink-0 text-muted-foreground" />
                            ) : (
                              <Brain className="size-3 shrink-0 text-muted-foreground" />
                            )}
                            <span className="truncate">{entry.member.activity}</span>
                          </p>
                        ) : null}
                      </div>
                      {entry.member ? (
                        <ChevronRight className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                      ) : null}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </section>
        ) : null}

        {activeUnassignedMembers.length > 0 ? (
          <section className="flex flex-col gap-2">
            <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
              {workstreams.length > 0 ? <T>Other members</T> : <T>Active roster</T>}
            </h3>
            <div className="flex flex-col gap-1.5">
              {activeUnassignedMembers.map((member) => (
                <SwarmMemberRow
                  key={member.name}
                  member={member}
                  isSelf={member.name === snapshot.member}
                  taskSummary={snapshot.plan?.tasks[member.name] ?? ""}
                  onInspect={() => props.onInspectMember(member.name)}
                />
              ))}
            </div>
          </section>
        ) : null}

        {recentPosts.length > 0 ? (
          <section className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h3 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
                <T>Latest board updates</T>
              </h3>
              <Button size="xs" variant="ghost" onClick={props.onOpenBoard}>
                <T>Open board</T>
              </Button>
            </div>
            <div className="flex flex-col gap-1.5">
              {recentPosts.map((post) => (
                <div
                  key={post.seq}
                  className="rounded-md border border-border bg-card/60 px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{post.agent}</span>
                    <span className="font-mono text-2xs text-muted-foreground">
                      {`#${post.seq}`}
                      {post.time ? ` · ${formatShortTime(post.time)}` : ""}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-muted-foreground">
                    {post.text}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function SwarmMessageRow(props: {
  readonly message: SwarmMessage;
  readonly isGroupStart: boolean;
  readonly recipientsChanged: boolean;
  readonly showUnreadDivider: boolean;
  readonly highlighted: boolean;
  readonly expanded: boolean;
  readonly headSeq: number;
  readonly selfMember: string | null;
  readonly onToggleExpand: () => void;
  readonly onJumpToSeq: (seq: number) => void;
  readonly onInspectAgent: () => void;
}) {
  const { message } = props;
  const collapsible = isLongPost(message.text);
  const displayText =
    collapsible && !props.expanded
      ? `${message.text.slice(0, COLLAPSE_CHAR_LIMIT)}…`
      : message.text;
  const segments = parseSwarmMessageSegments(displayText, props.headSeq);

  return (
    <div
      data-swarm-seq={message.seq}
      className={cn(
        "rounded-md transition-colors",
        props.highlighted && "bg-primary/10 px-2 py-1.5 ring-1 ring-primary/30",
      )}
    >
      {props.showUnreadDivider ? (
        <div className="my-2 flex items-center gap-2 text-2xs font-medium text-primary">
          <span className="h-px flex-1 bg-primary/40" />
          <span>
            <T>New</T>
          </span>
          <span className="h-px flex-1 bg-primary/40" />
        </div>
      ) : null}

      {props.isGroupStart ? (
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            <button
              type="button"
              onClick={props.onInspectAgent}
              className="cursor-pointer font-medium text-foreground text-xs hover:underline"
            >
              {message.agent}
            </button>
            {message.channel ? (
              <span className="font-mono text-2xs text-muted-foreground">
                {`#${message.channel}`}
              </span>
            ) : null}
            {message.all || message.mentions.length > 0 ? (
              <span className="truncate text-2xs text-muted-foreground">
                {"→ "}
                {[
                  ...(message.all ? ["@all"] : []),
                  ...message.mentions.map((mention) => `@${mention}`),
                ].join(" ")}
              </span>
            ) : null}
          </div>
          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
            {`#${message.seq}`}
            {message.time ? ` · ${formatShortTime(message.time)}` : ""}
          </span>
        </div>
      ) : (
        <div className="mb-0.5 flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-1.5">
            {props.recipientsChanged && message.channel ? (
              <span className="font-mono text-2xs text-muted-foreground">
                {`#${message.channel}`}
              </span>
            ) : null}
            {props.recipientsChanged && (message.all || message.mentions.length > 0) ? (
              <span className="truncate text-2xs text-muted-foreground">
                {"→ "}
                {[
                  ...(message.all ? ["@all"] : []),
                  ...message.mentions.map((mention) => `@${mention}`),
                ].join(" ")}
              </span>
            ) : null}
          </div>
          <span className="shrink-0 font-mono text-3xs text-muted-foreground/70">{`#${message.seq}`}</span>
        </div>
      )}

      <div className="whitespace-pre-wrap break-words text-xs leading-relaxed text-foreground">
        {segments.map((segment) => {
          const segKey = `${message.seq}:${segment.offset}`;
          if (segment.kind === "text") {
            return <span key={segKey}>{segment.value}</span>;
          }
          if (segment.kind === "seq") {
            return (
              <button
                key={segKey}
                type="button"
                onClick={() => props.onJumpToSeq(segment.seq)}
                className="mx-0.5 inline-flex cursor-pointer items-center rounded bg-muted px-1 py-0.25 font-mono text-2xs text-foreground hover:bg-accent"
              >
                {segment.value}
              </button>
            );
          }
          if (segment.kind === "mention") {
            const isSelfMention =
              props.selfMember !== null &&
              segment.target.toLowerCase() === props.selfMember.toLowerCase();
            return (
              <span
                key={segKey}
                className={cn(
                  "rounded px-1 py-0.25 font-medium text-xs",
                  isSelfMention ? "bg-primary/15 text-primary" : "bg-muted text-foreground",
                )}
              >
                {segment.value}
              </span>
            );
          }
          return (
            <span
              key={segKey}
              className="rounded bg-muted px-1 py-0.25 font-mono text-xs text-foreground"
            >
              {segment.value}
            </span>
          );
        })}
      </div>

      {collapsible ? (
        <button
          type="button"
          onClick={props.onToggleExpand}
          className="mt-1 cursor-pointer text-muted-foreground text-xs hover:text-foreground hover:underline"
        >
          {props.expanded ? <T>Show less</T> : <T>Show more</T>}
        </button>
      ) : null}
    </div>
  );
}

function SwarmMemberRow(props: {
  readonly member: SwarmMember;
  readonly isSelf: boolean;
  readonly taskSummary: string;
  readonly onInspect: () => void;
}) {
  const gt = useGT();
  const { member } = props;

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5",
        member.killed && "opacity-60",
      )}
      data-testid="swarm-member-row"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-1.5">
          <StatusDot status={member.status} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={cn("font-medium text-foreground text-sm", member.killed && "line-through")}
            >
              {member.name}
            </span>
            {props.isSelf ? (
              <Badge size="sm" variant="info">
                <T>you</T>
              </Badge>
            ) : null}
            {member.role && member.role !== "worker" && member.role !== member.name ? (
              <Badge size="sm" variant="outline">
                {member.role}
              </Badge>
            ) : null}
            {member.model ? (
              <span className="truncate font-mono text-2xs text-muted-foreground">
                {member.model}
              </span>
            ) : null}
            {member.workspaceMode && member.workspaceMode !== "inherit" ? (
              <Badge size="sm" variant="secondary">
                {member.workspaceMode}
              </Badge>
            ) : null}
          </div>

          <p className="mt-0.5 text-muted-foreground text-xs">
            {member.status === "working"
              ? gt("Working")
              : member.status === "killed"
                ? gt("Killed")
                : member.wakeMode === "mentions"
                  ? gt("Waiting for @mentions")
                  : gt("Waiting")}
            {member.steps > 0
              ? ` · ${gt("{count, plural, one {{count} step} other {{count} steps}}", { count: member.steps })}`
              : ""}
            {member.posts > 0
              ? ` · ${gt("{count, plural, one {{count} post} other {{count} posts}}", { count: member.posts })}`
              : ""}
            {member.unread > 0 && !member.killed
              ? ` · ${gt("{count} unread", { count: member.unread })}`
              : ""}
          </p>

          {props.taskSummary ? (
            <p className="mt-1 text-muted-foreground text-xs">{props.taskSummary}</p>
          ) : null}

          {member.status === "working" && member.activity ? (
            <p className="mt-1 flex items-center gap-1.5 truncate font-mono text-2xs text-foreground/85">
              {member.activityKind === "tool" ? (
                <Wrench className="size-3 shrink-0 text-muted-foreground" />
              ) : (
                <Brain className="size-3 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{member.activity}</span>
            </p>
          ) : null}

          {member.failure ? (
            <p className="mt-1 text-destructive-foreground text-xs">{member.failure.text}</p>
          ) : null}
        </div>
      </div>

      <Button size="xs" variant="ghost" onClick={props.onInspect}>
        <T>Inspect</T>
      </Button>
    </div>
  );
}
