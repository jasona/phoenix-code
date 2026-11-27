import {
  countSwarmMembers,
  deriveSwarmWorkstreams,
  filterSwarmMessages,
  groupSwarmMessages,
  sortSwarmMembers,
} from "@t3tools/client-runtime/swarm-board";
import {
  EnvironmentId,
  ThreadId,
  type OrchestrationV2GetSwarmMemberTranscriptResult,
  type SwarmMember,
  type SwarmSnapshot,
} from "@t3tools/contracts";
import { useIsFocused, useNavigation, type StaticScreenProps } from "@react-navigation/native";
import { T, useGT } from "gt-react-native";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import { useAppForeground } from "../../lib/appState";
import { useServerConfigs } from "../../state/entities";
import { orchestrationEnvironment } from "../../state/orchestration";
import { useEnvironmentQuery } from "../../state/query";
import { useAtomCommand } from "../../state/use-atom-command";

type SwarmTabId = "overview" | "board" | "members";

const POLL_ACTIVE_MS = 2_500;
const POLL_EMPTY_MS = 4_000;

function stepLabel(type: string): string {
  const words = type.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function SwarmBoardScreen({
  route,
}: StaticScreenProps<{ environmentId: string; threadId: string }>) {
  const gt = useGT();
  const navigation = useNavigation();
  const focused = useIsFocused();
  const foreground = useAppForeground();
  const insets = useSafeAreaInsets();
  const environmentId = EnvironmentId.make(route.params.environmentId);
  const threadId = ThreadId.make(route.params.threadId);
  const supported =
    useServerConfigs().get(environmentId)?.environment.capabilities.swarmBoard === true;
  const readSwarmBoard = useAtomCommand(orchestrationEnvironment.swarmBoardRead, {
    reportFailure: false,
  });

  const [snapshot, setSnapshot] = useState<SwarmSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [manualTab, setManualTab] = useState<SwarmTabId | null>(null);
  const [search, setSearch] = useState("");
  const [selectedChannel, setSelectedChannel] = useState("");
  const [showKilled, setShowKilled] = useState(false);
  const [inspectedMemberName, setInspectedMemberName] = useState<string | null>(null);
  const etagRef = useRef<string | undefined>(undefined);
  const inFlightRef = useRef(false);

  const poll = useEffectEvent(async (forceFull: boolean) => {
    if (!supported || inFlightRef.current) return;
    inFlightRef.current = true;
    const result = await readSwarmBoard({
      environmentId,
      input: {
        threadId,
        tail: 200,
        ...(!forceFull && etagRef.current ? { etag: etagRef.current } : {}),
      },
    });
    inFlightRef.current = false;
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the thread's on-disk swarm state via etag while the screen is focused and foregrounded
  useEffect(() => {
    if (!supported || !focused || !foreground) return;
    etagRef.current = undefined;
    void poll(false);
    const timer = setInterval(
      () => {
        void poll(false);
      },
      hasSwarm ? POLL_ACTIVE_MS : POLL_EMPTY_MS,
    );
    return () => clearInterval(timer);
  }, [supported, focused, foreground, hasSwarm]);

  const inspectedMember =
    inspectedMemberName && snapshot
      ? (snapshot.members.find((candidate) => candidate.name === inspectedMemberName) ?? null)
      : null;

  const close = () => {
    if (inspectedMember) {
      setInspectedMemberName(null);
      return;
    }
    navigation.goBack();
  };

  if (inspectedMember) {
    return (
      <View className="flex-1 bg-screen">
        <AppBar title={inspectedMember.name} subtitle={gt("Worker transcript")} onClose={close} />
        <MobileMemberTranscript
          environmentId={environmentId}
          threadId={threadId}
          member={inspectedMember}
        />
      </View>
    );
  }

  const hasOverviewContent =
    snapshot !== null && (snapshot.plan !== null || snapshot.systemAttention.length > 0);
  const activeTab: SwarmTabId = manualTab ?? (hasOverviewContent ? "overview" : "board");
  const counts = snapshot ? countSwarmMembers(snapshot.members) : null;
  const sortedMembers = snapshot ? sortSwarmMembers(snapshot.members) : [];
  const filteredMessages = snapshot
    ? filterSwarmMessages(snapshot.messages, {
        search,
        fromAgent: "",
        toMember: "",
        channel: selectedChannel,
        hiddenAgents: new Set(),
      })
    : [];
  const messageGroups = snapshot ? groupSwarmMessages(filteredMessages, snapshot.member) : [];

  return (
    <View className="flex-1 bg-screen">
      <AppBar
        title={snapshot?.title ?? gt("Swarm")}
        subtitle={
          counts
            ? gt("{active} active · {waiting} waiting", {
                active: counts.active,
                waiting: counts.waiting,
              })
            : undefined
        }
        onClose={close}
      />

      {!supported ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="text-center font-sans text-sm text-foreground-secondary">
            <T>Update this environment’s Phoenix server to view the Swarm board.</T>
          </Text>
        </View>
      ) : !loaded && snapshot === null ? (
        <View className="flex-1 items-center justify-center p-6">
          <Text className="font-sans text-sm text-foreground-secondary">
            <T>Looking for this conversation’s swarm…</T>
          </Text>
        </View>
      ) : snapshot === null ? (
        <View className="flex-1 items-center justify-center gap-3 p-6">
          <Text className="font-t3-bold text-base text-foreground">
            <T>No swarm in this conversation</T>
          </Text>
          <Text className="text-center font-sans text-sm text-foreground-secondary">
            <T>Start a native Antigravity swarm with /swarm and this view updates automatically.</T>
          </Text>
          {errorText ? (
            <Text className="font-sans text-xs text-danger-foreground">{errorText}</Text>
          ) : null}
          <Button label={gt("Refresh")} tone="secondary" onPress={() => void poll(true)} />
        </View>
      ) : (
        <View className="flex-1">
          <View className="flex-row gap-2 border-b border-border px-4 py-2">
            {(
              [
                { id: "overview", label: gt("Overview") },
                { id: "board", label: `${gt("Board")} (${snapshot.totalMessages})` },
                { id: "members", label: `${gt("Members")} (${counts?.total ?? 0})` },
              ] as const
            ).map((tab) => (
              <Pressable
                key={tab.id}
                onPress={() => setManualTab(tab.id)}
                className={`rounded-md px-3 py-1.5 ${
                  activeTab === tab.id ? "bg-accent" : "bg-transparent"
                }`}
              >
                <Text
                  className={`font-sans text-xs ${
                    activeTab === tab.id
                      ? "font-t3-bold text-foreground"
                      : "text-foreground-secondary"
                  }`}
                >
                  {tab.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {activeTab === "overview" ? (
            <ScrollView
              contentContainerStyle={{
                gap: 14,
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: Math.max(24, insets.bottom),
              }}
            >
              {snapshot.systemAttention.map((alert) => (
                <Pressable
                  key={alert.id}
                  onPress={() => setInspectedMemberName(alert.member)}
                  className="gap-1 rounded-lg border border-border bg-surface p-3"
                >
                  <Text className="font-t3-bold text-xs text-foreground">{alert.text}</Text>
                  {alert.detail ? (
                    <Text className="font-sans text-xs text-foreground-secondary">
                      {alert.detail}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
              {snapshot.plan?.goal ? (
                <View className="gap-1 rounded-lg border border-border bg-surface p-3">
                  <Text className="font-t3-bold text-sm text-foreground">
                    {snapshot.plan.goal.title}
                  </Text>
                  {snapshot.plan.goal.line ? (
                    <Text className="font-sans text-xs text-foreground-secondary">
                      {snapshot.plan.goal.line}
                    </Text>
                  ) : null}
                </View>
              ) : null}
              {deriveSwarmWorkstreams(snapshot).workstreams.map((workstream) => (
                <View
                  key={workstream.id}
                  className="gap-2 rounded-lg border border-border bg-surface p-3"
                >
                  <Text className="font-t3-bold text-sm text-foreground">{workstream.title}</Text>
                  {workstream.goal ? (
                    <Text className="font-sans text-xs text-foreground-secondary">
                      {workstream.goal}
                    </Text>
                  ) : null}
                  {workstream.members.map((entry) => (
                    <Pressable
                      key={entry.name}
                      onPress={() => {
                        if (entry.member) setInspectedMemberName(entry.name);
                      }}
                      className="gap-0.5 border-t border-border pt-2"
                    >
                      <Text className="font-t3-bold text-xs text-foreground">
                        {entry.name} · {entry.member?.status ?? "waiting"}
                      </Text>
                      {entry.task ? (
                        <Text className="font-sans text-xs text-foreground-secondary">
                          {entry.task}
                        </Text>
                      ) : null}
                      {entry.member?.activity ? (
                        <Text className="font-mono text-xs text-foreground-secondary">
                          {entry.member.activity}
                        </Text>
                      ) : null}
                    </Pressable>
                  ))}
                </View>
              ))}
            </ScrollView>
          ) : null}

          {activeTab === "board" ? (
            <View className="flex-1">
              <View className="gap-2 border-b border-border px-4 py-2">
                <TextInput
                  value={search}
                  onChangeText={setSearch}
                  placeholder={gt("Search posts…")}
                  className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-foreground"
                />
                {snapshot.channels.length > 0 ? (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View className="flex-row gap-1.5">
                      {[
                        { key: "", label: gt("All") },
                        { key: "main", label: "#main" },
                        ...snapshot.channels.map((ch) => ({ key: ch.name, label: `#${ch.name}` })),
                      ].map((ch) => (
                        <Pressable
                          key={ch.key || "__all__"}
                          onPress={() => setSelectedChannel(ch.key)}
                          className={`rounded-md px-2.5 py-1 ${
                            selectedChannel === ch.key ? "bg-accent" : "bg-surface"
                          }`}
                        >
                          <Text className="font-mono text-xs text-foreground">{ch.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </ScrollView>
                ) : null}
              </View>
              <ScrollView
                contentContainerStyle={{
                  gap: 14,
                  paddingHorizontal: 16,
                  paddingTop: 12,
                  paddingBottom: Math.max(24, insets.bottom),
                }}
              >
                {messageGroups.length === 0 ? (
                  <Text className="py-8 text-center font-sans text-sm text-foreground-secondary">
                    <T>No board posts yet.</T>
                  </Text>
                ) : (
                  messageGroups.map((group) => (
                    <View key={group.id} className="gap-2">
                      {group.messages.map((message, index) => (
                        <View key={message.seq} className="gap-1">
                          {index === 0 ? (
                            <View className="flex-row items-center justify-between gap-2">
                              <Text className="font-t3-bold text-xs text-foreground">
                                {message.agent}
                                {message.channel ? ` #${message.channel}` : ""}
                              </Text>
                              <Text className="font-mono text-xs text-foreground-secondary">
                                {`#${message.seq}`}
                              </Text>
                            </View>
                          ) : null}
                          <Text selectable className="font-sans text-sm text-foreground">
                            {message.text}
                          </Text>
                        </View>
                      ))}
                    </View>
                  ))
                )}
              </ScrollView>
            </View>
          ) : null}

          {activeTab === "members" ? (
            <ScrollView
              contentContainerStyle={{
                gap: 10,
                paddingHorizontal: 16,
                paddingTop: 12,
                paddingBottom: Math.max(24, insets.bottom),
              }}
            >
              {sortedMembers.some((member) => member.killed) ? (
                <View className="flex-row justify-end">
                  <Button
                    label={showKilled ? gt("Hide killed") : gt("Show killed")}
                    tone="secondary"
                    onPress={() => setShowKilled((current) => !current)}
                  />
                </View>
              ) : null}
              {sortedMembers
                .filter((member) => showKilled || !member.killed)
                .map((member) => (
                  <Pressable
                    key={member.name}
                    onPress={() => setInspectedMemberName(member.name)}
                    className="gap-1 rounded-lg border border-border bg-surface p-3"
                  >
                    <View className="flex-row items-center justify-between gap-2">
                      <Text className="font-t3-bold text-sm text-foreground">{member.name}</Text>
                      <Text className="font-sans text-xs text-foreground-secondary">
                        {member.status}
                      </Text>
                    </View>
                    <Text className="font-sans text-xs text-foreground-secondary">
                      {member.model ? `${member.model} · ` : ""}
                      {gt("{count, plural, one {{count} step} other {{count} steps}}", {
                        count: member.steps,
                      })}
                      {member.posts > 0
                        ? ` · ${gt("{count, plural, one {{count} post} other {{count} posts}}", { count: member.posts })}`
                        : ""}
                    </Text>
                    {member.status === "working" && member.activity ? (
                      <Text className="font-mono text-xs text-foreground">{member.activity}</Text>
                    ) : null}
                    {member.failure ? (
                      <Text className="font-sans text-xs text-danger-foreground">
                        {member.failure.text}
                      </Text>
                    ) : null}
                  </Pressable>
                ))}
            </ScrollView>
          ) : null}
        </View>
      )}
    </View>
  );
}

function MobileMemberTranscript(props: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly member: SwarmMember;
}) {
  const gt = useGT();
  const insets = useSafeAreaInsets();
  const query = useEnvironmentQuery<OrchestrationV2GetSwarmMemberTranscriptResult, unknown>(
    orchestrationEnvironment.swarmMemberTranscript({
      environmentId: props.environmentId,
      input: { threadId: props.threadId, memberName: props.member.name },
    }),
  );
  const steps = query.data?.steps;
  return (
    <ScrollView
      contentContainerStyle={{
        gap: 12,
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: Math.max(24, insets.bottom),
      }}
    >
      <Text className="font-sans text-xs text-foreground-secondary">
        <T>Read-only worker transcript.</T>
      </Text>
      {query.error !== null ? (
        <Text selectable className="font-sans text-sm text-danger-foreground">
          {query.error}
        </Text>
      ) : steps === undefined ? (
        <Text className="font-sans text-sm text-foreground-secondary">
          <T>Loading transcript…</T>
        </Text>
      ) : steps === null || steps.length === 0 ? (
        <Text className="font-sans text-sm text-foreground-secondary">
          <T>No transcript steps recorded yet.</T>
        </Text>
      ) : (
        steps.map((step) => {
          const seenCalls = new Map<string, number>();
          const keyedCalls = step.toolCalls.map((call) => {
            const baseKey = `${step.index}:${call.name}:${call.input}`;
            const count = (seenCalls.get(baseKey) ?? 0) + 1;
            seenCalls.set(baseKey, count);
            return { key: `${baseKey}#${count}`, call };
          });
          return (
            <View key={`${step.index}:${step.type}`} className="gap-1 border-l border-border ps-3">
              <Text className="font-t3-bold text-xs text-foreground-secondary">
                {`#${step.index} · ${stepLabel(step.type)}`}
                {step.status !== null && step.status !== "DONE"
                  ? ` · ${stepLabel(step.status)}`
                  : ""}
              </Text>
              {keyedCalls.map(({ key, call }) => (
                <Text key={key} selectable className="font-mono text-xs text-foreground">
                  {`${call.name} ${call.input}`}
                </Text>
              ))}
              {step.text !== null && step.text.trim().length > 0 ? (
                <Text selectable className="font-mono text-xs text-foreground">
                  {step.text}
                </Text>
              ) : null}
            </View>
          );
        })
      )}
      <View className="flex-row justify-end">
        <Button
          label={gt("Refresh")}
          tone="secondary"
          disabled={query.isPending}
          onPress={query.refresh}
        />
      </View>
    </ScrollView>
  );
}
