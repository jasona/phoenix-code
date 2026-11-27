import type { SwarmMember, SwarmMessage, SwarmSnapshot } from "@t3tools/contracts";

export interface SwarmMemberCounts {
  readonly active: number;
  readonly waiting: number;
  readonly killed: number;
  readonly total: number;
}

export interface SwarmMessageFilter {
  readonly search: string;
  readonly fromAgent: string;
  readonly toMember: string;
  readonly channel: string;
  readonly hiddenAgents: ReadonlySet<string>;
}

export interface SwarmMessageGroup {
  readonly id: string;
  readonly agent: string;
  readonly firstTime: string;
  readonly messages: ReadonlyArray<SwarmMessage>;
  readonly mentionsSelf: boolean;
}

export type SwarmMessageSegment =
  | { readonly kind: "text"; readonly value: string; readonly offset: number }
  | {
      readonly kind: "mention";
      readonly value: string;
      readonly target: string;
      readonly offset: number;
    }
  | {
      readonly kind: "channel";
      readonly value: string;
      readonly channel: string;
      readonly offset: number;
    }
  | { readonly kind: "seq"; readonly value: string; readonly seq: number; readonly offset: number };

export interface SwarmWorkstreamCard {
  readonly id: string;
  readonly title: string;
  readonly goal: string;
  readonly members: ReadonlyArray<{
    readonly name: string;
    readonly task: string;
    readonly member: SwarmMember | null;
  }>;
  readonly activeCount: number;
  readonly waitingCount: number;
  readonly killedCount: number;
  readonly hasAlert: boolean;
}

const GROUP_GAP_MS = 10 * 60 * 1000;

function statusRank(status: SwarmMember["status"]): number {
  if (status === "working") return 0;
  if (status === "waiting") return 1;
  return 2;
}

/** Active first, then waiting, then killed; coordinator first within each status, then alphabetical. */
export function sortSwarmMembers(members: ReadonlyArray<SwarmMember>): ReadonlyArray<SwarmMember> {
  return [...members].sort(
    (left, right) =>
      statusRank(left.status) - statusRank(right.status) ||
      (left.role === "coordinator" ? 0 : 1) - (right.role === "coordinator" ? 0 : 1) ||
      left.name.localeCompare(right.name),
  );
}

/** Excludes role workers (narrator/monitor) from task-worker counts, matching Antigravity's board header. */
export function countSwarmMembers(members: ReadonlyArray<SwarmMember>): SwarmMemberCounts {
  let active = 0;
  let waiting = 0;
  let killed = 0;
  for (const member of members) {
    if (member.roleWorker) continue;
    if (member.status === "working") active += 1;
    else if (member.status === "waiting") waiting += 1;
    else killed += 1;
  }
  return { active, waiting, killed, total: active + waiting + killed };
}

function parseSwarmTimeMs(time: string): number | null {
  if (!time) return null;
  const normalized = time.includes("T") ? time : time.replace(" ", "T");
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function filterSwarmMessages(
  messages: ReadonlyArray<SwarmMessage>,
  filter: SwarmMessageFilter,
): ReadonlyArray<SwarmMessage> {
  const query = filter.search.trim().toLowerCase();
  return messages.filter((message) => {
    if (message.control) return false;
    if (filter.hiddenAgents.has(message.agent)) return false;
    if (filter.fromAgent && message.agent !== filter.fromAgent) return false;
    if (filter.toMember) {
      const matchesRecipient = message.all || message.mentions.includes(filter.toMember);
      if (!matchesRecipient) return false;
    }
    if (filter.channel) {
      const msgChannel = message.channel ?? "main";
      if (msgChannel !== filter.channel) return false;
    }
    if (query) {
      const haystack = `${message.agent} ${message.text} #${message.seq}`.toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function groupSwarmMessages(
  messages: ReadonlyArray<SwarmMessage>,
  selfMember: string | null,
): ReadonlyArray<SwarmMessageGroup> {
  const groups: Array<{
    id: string;
    agent: string;
    firstTime: string;
    lastTimeMs: number | null;
    messages: Array<SwarmMessage>;
    mentionsSelf: boolean;
  }> = [];

  for (const message of messages) {
    const timeMs = parseSwarmTimeMs(message.time);
    const mentionsSelf = selfMember !== null && message.mentions.includes(selfMember);
    const previous = groups[groups.length - 1];
    const withinGap =
      previous !== undefined &&
      previous.agent === message.agent &&
      (previous.lastTimeMs === null ||
        timeMs === null ||
        Math.abs(timeMs - previous.lastTimeMs) <= GROUP_GAP_MS);
    if (withinGap) {
      previous.messages.push(message);
      previous.lastTimeMs = timeMs ?? previous.lastTimeMs;
      previous.mentionsSelf = previous.mentionsSelf || mentionsSelf;
    } else {
      groups.push({
        id: `${message.seq}:${message.agent}`,
        agent: message.agent,
        firstTime: message.time,
        lastTimeMs: timeMs,
        messages: [message],
        mentionsSelf,
      });
    }
  }

  return groups.map(({ lastTimeMs: _lastTimeMs, ...group }) => group);
}

/** Splits message text into plain runs, @mentions, @#channels, and clickable #seq citations. */
export function parseSwarmMessageSegments(
  text: string,
  headSeq: number,
): ReadonlyArray<SwarmMessageSegment> {
  const segments: Array<SwarmMessageSegment> = [];
  const pattern =
    /(^|[^A-Za-z0-9_/-])(?:(@#)([A-Za-z0-9][A-Za-z0-9_-]*)|(@)([A-Za-z0-9][A-Za-z0-9_-]*)|(#)(\d+)(?![A-Za-z0-9_-]))/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const matchStart = match.index ?? 0;
    const prefix = match[1] ?? "";
    const tokenStart = matchStart + prefix.length;
    if (tokenStart > cursor) {
      segments.push({ kind: "text", value: text.slice(cursor, tokenStart), offset: cursor });
    }

    if (match[2] === "@#" && match[3]) {
      segments.push({
        kind: "channel",
        value: `@#${match[3]}`,
        channel: match[3],
        offset: tokenStart,
      });
    } else if (match[4] === "@" && match[5]) {
      segments.push({
        kind: "mention",
        value: `@${match[5]}`,
        target: match[5],
        offset: tokenStart,
      });
    } else if (match[6] === "#" && match[7]) {
      const seq = Number(match[7]);
      if (Number.isInteger(seq) && seq >= 1 && (headSeq <= 0 || seq <= headSeq)) {
        segments.push({ kind: "seq", value: `#${seq}`, seq, offset: tokenStart });
      } else {
        segments.push({ kind: "text", value: `#${match[7]}`, offset: tokenStart });
      }
    }
    cursor = matchStart + match[0].length;
  }

  if (cursor < text.length) {
    segments.push({ kind: "text", value: text.slice(cursor), offset: cursor });
  }
  return segments;
}

export function deriveSwarmWorkstreams(snapshot: SwarmSnapshot): {
  readonly workstreams: ReadonlyArray<SwarmWorkstreamCard>;
  readonly unassignedMembers: ReadonlyArray<SwarmMember>;
} {
  const memberByName = new Map(snapshot.members.map((member) => [member.name, member]));
  const alertMembers = new Set(snapshot.systemAttention.map((alert) => alert.member));
  const assigned = new Set<string>();
  const tasks = snapshot.plan?.tasks ?? {};

  const workstreams: Array<SwarmWorkstreamCard> = (snapshot.plan?.threads ?? []).map((thread) => {
    let activeCount = 0;
    let waitingCount = 0;
    let killedCount = 0;
    let hasAlert = false;
    const members = thread.tasks.map((name) => {
      assigned.add(name);
      const member = memberByName.get(name) ?? null;
      if (member) {
        if (member.status === "working") activeCount += 1;
        else if (member.status === "waiting") waitingCount += 1;
        else killedCount += 1;
      }
      if (alertMembers.has(name) || member?.failure) hasAlert = true;
      return {
        name,
        task: tasks[name] ?? "",
        member,
      };
    });
    return {
      id: thread.id,
      title: thread.title,
      goal: thread.goal,
      members,
      activeCount,
      waitingCount,
      killedCount,
      hasAlert,
    };
  });

  const unassignedMembers = sortSwarmMembers(
    snapshot.members.filter(
      (member) => !assigned.has(member.name) && member.role !== "coordinator",
    ),
  );

  return { workstreams, unassignedMembers };
}
