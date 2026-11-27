// @effect-diagnostics nodeBuiltinImport:off -- direct bounded tail reads and O_NOFOLLOW keep native swarm reads safe and fast.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

import type {
  OrchestrationV2GetSwarmBoardResult,
  OrchestrationV2GetSwarmMemberTranscriptResult,
  SwarmChannel,
  SwarmMember,
  SwarmMemberFailure,
  SwarmMemberStatus,
  SwarmMemberTranscriptStep,
  SwarmMessage,
  SwarmPlan,
  SwarmSystemAlert,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Predicate from "effect/Predicate";
import * as Schema from "effect/Schema";

import { antigravityManagedPath, antigravityProfileRoot } from "./AntigravityProfilePaths.ts";

const NATIVE_ID = /^[A-Za-z0-9-]{8,64}$/;
const ROLE_WORKER_RE = /^(?:narrator|monitor)(?:-\d+)?$/;
const QUOTA_RE = /RESOURCE_EXHAUSTED|quota|\b429\b|exhausted your capacity|rate.?limit/i;

const MEMBERS_MAX_BYTES = 256 * 1024;
const PLAN_MAX_BYTES = 64 * 1024;
const BOARD_MAX_BYTES = 4 * 1024 * 1024;
const TRANSCRIPT_SUMMARY_TAIL_BYTES = 128 * 1024;
const TRANSCRIPT_DETAIL_TAIL_BYTES = 256 * 1024;
const DEFAULT_MESSAGE_TAIL = 200;
const MAX_MESSAGE_TAIL = 500;
const STEP_TEXT_CAP = 4_000;
const TOOL_INPUT_CAP = 1_000;
const STUCK_MS = 10 * 60 * 1000;
const STEP_ERROR_SETTLE_MS = 60 * 1000;

const BOARD_ACTIVITY: Readonly<Record<string, string>> = {
  swarm_wait: "Waiting for posts",
  read_board: "Reading the board",
  post_message: "Posting to the board",
};

const RawRosterMember = Schema.Struct({
  conversation_id: Schema.optional(Schema.String),
  role: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  desired_model: Schema.optional(Schema.String),
  applied_model: Schema.optional(Schema.String),
  phase: Schema.optional(Schema.String),
  desired_state: Schema.optional(Schema.String),
  wake_mode: Schema.optional(Schema.String),
  wait_since: Schema.optional(Schema.Number),
  last_read_seq: Schema.optional(Schema.Number),
  killed: Schema.optional(Schema.Boolean),
  workspace_mode: Schema.optional(Schema.String),
  channels: Schema.optional(Schema.Array(Schema.String)),
});
type RawRosterMember = typeof RawRosterMember.Type;

const RawRoster = Schema.Struct({
  title: Schema.optional(Schema.String),
  members: Schema.optional(Schema.Record(Schema.String, RawRosterMember)),
});
const decodeRawRoster = Schema.decodeUnknownOption(Schema.fromJsonString(RawRoster));

const RawBoardMessage = Schema.Struct({
  seq: Schema.optional(Schema.Number),
  agent: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  time: Schema.optional(Schema.String),
  kind: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
  topic: Schema.optional(Schema.String),
  control: Schema.optional(Schema.Boolean),
});
const decodeRawBoardMessage = Schema.decodeUnknownOption(Schema.fromJsonString(RawBoardMessage));

const RawPlan = Schema.Struct({
  goal: Schema.optional(
    Schema.Struct({
      title: Schema.optional(Schema.String),
      line: Schema.optional(Schema.String),
    }),
  ),
  tasks: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  threads: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: Schema.optional(Schema.String),
        title: Schema.optional(Schema.String),
        goal: Schema.optional(Schema.String),
        tasks: Schema.optional(Schema.Array(Schema.String)),
      }),
    ),
  ),
});
const decodeRawPlan = Schema.decodeUnknownOption(Schema.fromJsonString(RawPlan));

const TranscriptLine = Schema.Struct({
  step_index: Schema.optional(Schema.Number),
  type: Schema.optional(Schema.String),
  status: Schema.optional(Schema.String),
  content: Schema.optional(Schema.String),
  thinking: Schema.optional(Schema.String),
  error: Schema.optional(Schema.String),
  tool_calls: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, args: Schema.optional(Schema.Unknown) })),
  ),
});
type TranscriptLine = typeof TranscriptLine.Type;
const decodeTranscriptLine = Schema.decodeUnknownOption(Schema.fromJsonString(TranscriptLine));
const decodeArgument = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));

export class AntigravitySwarmReadError extends Schema.TaggedError<AntigravitySwarmReadError>()(
  "AntigravitySwarmReadError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not read Antigravity swarm records.";
  }
}

function nonNegativeInt(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function roleOf(name: string, member: RawRosterMember): string {
  const role = member.role ?? "";
  if (role && role !== "worker") return role;
  const match = /^(narrator|monitor)(?:-\d+)?$/.exec(name);
  return match?.[1] ?? (role || "worker");
}

function isRoleWorker(name: string, member: RawRosterMember): boolean {
  const role = roleOf(name, member);
  return (role !== "" && role !== "worker" && role !== "coordinator") || ROLE_WORKER_RE.test(name);
}

function unquote(value: unknown): string {
  if (typeof value !== "string") return value == null ? "" : String(value);
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return Option.match(decodeArgument(trimmed), {
      onNone: () => trimmed.slice(1, -1),
      onSome: (decoded) => String(decoded),
    });
  }
  return trimmed;
}

function oneLine(value: string, maxLen = 96): string {
  const normalized = value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return normalized.length > maxLen ? `${normalized.slice(0, maxLen - 1).trimEnd()}…` : normalized;
}

function describeToolCall(tc: { readonly name: string; readonly args?: unknown }): string {
  const name = tc.name;
  if (!name) return "";
  const boardLabel = BOARD_ACTIVITY[name];
  if (boardLabel) return boardLabel;
  const args = Predicate.isObject(tc.args) ? (tc.args as Record<string, unknown>) : {};
  const summary = unquote(args.toolSummary) || unquote(args.toolAction);
  if (summary) return oneLine(summary);
  const targetPath = unquote(args.Path || args.AbsolutePath || args.TargetFile);
  if (targetPath) {
    const verb =
      name === "read_file"
        ? "Read"
        : name === "write_file"
          ? "Write"
          : name === "edit_file"
            ? "Edit"
            : undefined;
    if (verb) return `${verb} ${NodePath.basename(targetPath)}`;
  }
  if (name === "code_search" && args.Query) return oneLine(`Search ${unquote(args.Query)}`);
  if (name === "swarm" && args.action) {
    return oneLine(`swarm ${unquote(args.action)} ${unquote(args.name)}`);
  }
  return name;
}

function thinkingHeading(thinking: string | undefined): string {
  if (!thinking) return "";
  let heading = "";
  for (const match of thinking.matchAll(/(?:^|\n)\s*\*\*([^*\n]{3,96})\*\*\s*(?=\n|$)/g)) {
    if (match[1]) heading = oneLine(match[1]);
  }
  return heading;
}

function extractMentions(
  text: string,
  rosterNames: ReadonlyArray<string>,
): {
  readonly mentions: ReadonlyArray<string>;
  readonly mentionChannels: ReadonlyArray<string>;
  readonly all: boolean;
} {
  const lowerToCanonical = new Map(rosterNames.map((name) => [name.toLowerCase(), name]));
  const mentions = new Set<string>();
  const mentionChannels = new Set<string>();
  let all = false;

  for (const match of text.matchAll(/(?:^|[^A-Za-z0-9_/-])@(#)?([A-Za-z0-9][A-Za-z0-9_-]*)/g)) {
    const isChannel = match[1] === "#";
    const token = (match[2] ?? "").toLowerCase();
    if (!token) continue;
    if (isChannel) {
      if (token !== "main") mentionChannels.add(token);
      continue;
    }
    if (token === "all") {
      all = true;
      continue;
    }
    const direct = lowerToCanonical.get(token);
    if (direct) {
      mentions.add(direct);
      continue;
    }
    // Numbered worker groups: @worker matches worker-1, worker-2, ...
    const prefix = `${token}-`;
    for (const candidate of rosterNames) {
      const lower = candidate.toLowerCase();
      if (lower.startsWith(prefix) && /^\d+$/.test(lower.slice(prefix.length))) {
        mentions.add(candidate);
      }
    }
  }

  return {
    mentions: [...mentions],
    mentionChannels: [...mentionChannels],
    all,
  };
}

interface TranscriptSummary {
  readonly steps: number;
  readonly activity: string;
  readonly activityKind: "tool" | "thinking" | "";
  readonly idle: boolean;
  readonly last: {
    readonly type: string;
    readonly status: string;
    readonly error: string;
  } | null;
  readonly mtime: number;
  readonly key: string;
}

const NO_TRANSCRIPT: TranscriptSummary = {
  steps: 0,
  activity: "",
  activityKind: "",
  idle: false,
  last: null,
  mtime: 0,
  key: "0:0",
};

function turnEnded(steps: ReadonlyArray<TranscriptLine>): boolean {
  const results: Array<TranscriptLine> = [];
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (!step) return false;
    if (step.type === "GENERIC") {
      results.unshift(step);
      continue;
    }
    if (step.type === "PLANNER_RESPONSE") {
      const calls = step.tool_calls ?? [];
      if (calls.length === 0) return true;
      const waitIndex = calls.findIndex((call) => call.name === "swarm_wait");
      if (waitIndex >= 0) {
        const result = results[waitIndex];
        return result !== undefined && result.status === "DONE";
      }
      return false;
    }
    return false;
  }
  return false;
}

function summarizeTranscriptLines(
  lines: ReadonlyArray<string>,
  mtime: number,
  key: string,
): TranscriptSummary {
  const parsed: Array<TranscriptLine> = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const step = Option.getOrUndefined(decodeTranscriptLine(line));
    if (step) parsed.push(step);
  }
  if (parsed.length === 0) return { ...NO_TRANSCRIPT, mtime, key };

  let steps = parsed.length;
  let activity = "";
  let activityKind: "tool" | "thinking" | "" = "";
  let last: TranscriptSummary["last"] = null;

  for (let index = parsed.length - 1; index >= 0; index -= 1) {
    const step = parsed[index];
    if (!step) continue;
    if (
      last === null &&
      typeof step.step_index === "number" &&
      Number.isFinite(step.step_index) &&
      step.step_index >= 0
    ) {
      steps = Math.max(steps, Math.floor(step.step_index) + 1 + (parsed.length - 1 - index));
    }
    if (last === null) {
      last = {
        type: step.type ?? "",
        status: step.status ?? "",
        error: typeof step.error === "string" ? oneLine(step.error, 240) : "",
      };
    }
    if (step.type === "USER_INPUT") break;
    if (step.type !== "PLANNER_RESPONSE") continue;
    const calls = step.tool_calls ?? [];
    if (calls.some((call) => call.name === "swarm_wait")) break;
    const labeled = [...calls].reverse().find((call) => describeToolCall(call) !== "");
    const label = labeled ? describeToolCall(labeled) : "";
    const heading = thinkingHeading(step.thinking);
    if (label) {
      activity = label;
      activityKind = "tool";
      break;
    }
    if (heading) {
      activity = heading;
      activityKind = "thinking";
      break;
    }
  }

  return {
    steps,
    activity,
    activityKind,
    idle: turnEnded(parsed),
    last,
    mtime,
    key,
  };
}

function memberFailureOf(summary: TranscriptSummary, now: number): SwarmMemberFailure | null {
  const last = summary.last;
  if (!last) return null;
  const isModelError = last.type === "ERROR_MESSAGE";
  const isSettledToolError =
    last.status === "ERROR" && summary.mtime > 0 && now - summary.mtime >= STEP_ERROR_SETTLE_MS;
  if (!isModelError && !isSettledToolError) return null;
  const detail = last.error || (isModelError ? "Model error" : "Tool step failed");
  return {
    kind: QUOTA_RE.test(detail) ? "quota" : "error",
    text: detail,
  };
}

function memberStatusOf(member: RawRosterMember, summary: TranscriptSummary): SwarmMemberStatus {
  const killed =
    member.killed === true || member.phase === "KILLED" || member.desired_state === "KILLED";
  if (killed) return "killed";
  if (summary.last !== null) {
    return summary.idle ? "waiting" : "working";
  }
  return member.wake_mode === "working" ? "working" : "waiting";
}

async function readManagedFileBounded(
  profileRoot: string,
  segments: ReadonlyArray<string>,
  maxBytes: number,
  fromTail: boolean,
): Promise<
  | {
      readonly text: string;
      readonly mtimeMs: number;
      readonly size: number;
      readonly truncated: boolean;
    }
  | undefined
> {
  const resolved = await antigravityManagedPath(profileRoot, segments, "file");
  if (!resolved) return undefined;
  const handle = await NodeFSP.open(
    resolved.path,
    NodeFS.constants.O_RDONLY | (NodeFS.constants.O_NOFOLLOW ?? 0),
  ).catch(() => undefined);
  if (!handle) return undefined;
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return undefined;
    if (!fromTail && stat.size > maxBytes) return undefined;
    const tailStart = fromTail ? Math.max(0, stat.size - maxBytes) : 0;
    const readStart = fromTail ? Math.max(0, tailStart - 1) : 0;
    const length = stat.size - readStart;
    if (length <= 0) {
      return { text: "", mtimeMs: Math.floor(stat.mtimeMs), size: stat.size, truncated: false };
    }
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, readStart);
    const bytes = buffer.subarray(0, bytesRead);
    let offset = 0;
    if (tailStart > 0) {
      const newline = bytes.indexOf(0x0a);
      if (newline === -1) {
        return { text: "", mtimeMs: Math.floor(stat.mtimeMs), size: stat.size, truncated: true };
      }
      offset = newline + 1;
    }
    return {
      text: bytes.toString("utf8", offset),
      mtimeMs: Math.floor(stat.mtimeMs),
      size: stat.size,
      truncated: tailStart > 0,
    };
  } finally {
    await handle.close();
  }
}

async function summarizeMemberTranscript(
  profileRoot: string,
  conversationId: string,
): Promise<TranscriptSummary> {
  if (!NATIVE_ID.test(conversationId)) return NO_TRANSCRIPT;
  const file = await readManagedFileBounded(
    profileRoot,
    ["antigravity-acp", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl"],
    TRANSCRIPT_SUMMARY_TAIL_BYTES,
    true,
  );
  if (!file) return NO_TRANSCRIPT;
  const key = `${file.mtimeMs}:${file.size}`;
  return summarizeTranscriptLines(file.text.split("\n"), file.mtimeMs, key);
}

const capText = (value: string, limit: number) =>
  value.length <= limit ? value : `${value.slice(0, limit)}…`;

const toolArguments = (args: unknown) =>
  Predicate.isObject(args)
    ? Object.fromEntries(
        Object.entries(args).map(([key, value]) => [
          key,
          typeof value === "string" ? Option.getOrElse(decodeArgument(value), () => value) : value,
        ]),
      )
    : (args ?? {});

function parseTranscriptSteps(contents: string): ReadonlyArray<SwarmMemberTranscriptStep> {
  const steps: Array<SwarmMemberTranscriptStep> = [];
  let fallbackIndex = 0;
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    const step = Option.getOrUndefined(decodeTranscriptLine(line));
    if (!step) continue;
    const index =
      typeof step.step_index === "number" &&
      Number.isFinite(step.step_index) &&
      step.step_index >= 0
        ? Math.floor(step.step_index)
        : fallbackIndex;
    fallbackIndex = index + 1;
    const body = step.content ?? step.error ?? step.thinking;
    steps.push({
      index,
      type: step.type ?? "STEP",
      status: step.status ?? null,
      text: body !== undefined ? capText(body, STEP_TEXT_CAP) : null,
      toolCalls: (step.tool_calls ?? []).map((call) => ({
        name: call.name,
        input: capText(JSON.stringify(toolArguments(call.args)), TOOL_INPUT_CAP),
      })),
    });
  }
  return steps;
}

function parsePlan(text: string): SwarmPlan | null {
  const decoded = Option.getOrUndefined(decodeRawPlan(text));
  if (!decoded) return null;
  const goal =
    decoded.goal && (decoded.goal.title || decoded.goal.line)
      ? {
          title: decoded.goal.title ?? "",
          line: decoded.goal.line ?? "",
        }
      : null;
  const tasks = decoded.tasks ?? {};
  const threads = (decoded.threads ?? [])
    .filter((thread) => Boolean(thread.id || thread.title))
    .map((thread, index) => ({
      id: thread.id ?? `thread-${index + 1}`,
      title: thread.title ?? thread.id ?? `Group ${index + 1}`,
      goal: thread.goal ?? "",
      tasks: [...(thread.tasks ?? [])],
    }));
  if (!goal && Object.keys(tasks).length === 0 && threads.length === 0) return null;
  return { goal, tasks, threads };
}

export const readAntigravitySwarmBoard = Effect.fn("readAntigravitySwarmBoard")(function* (input: {
  readonly profileDirectory: string;
  readonly rootSessionId: string;
  readonly etag?: string | undefined;
  readonly tail?: number | undefined;
  readonly nowMs?: number | undefined;
}) {
  if (!NATIVE_ID.test(input.rootSessionId)) {
    return { swarm: null } satisfies OrchestrationV2GetSwarmBoardResult;
  }
  const now = input.nowMs ?? (yield* Clock.currentTimeMillis);
  return yield* Effect.tryPromise({
    try: async (): Promise<OrchestrationV2GetSwarmBoardResult> => {
      const profileRoot = await antigravityProfileRoot(input.profileDirectory);
      if (profileRoot === undefined) return { swarm: null };
      const swarmSegments = [
        "antigravity-acp",
        "brain",
        input.rootSessionId,
        ".system_generated",
        "swarm",
      ];
      const membersFile = await readManagedFileBounded(
        profileRoot,
        [...swarmSegments, "members.json"],
        MEMBERS_MAX_BYTES,
        false,
      );
      if (!membersFile) return { swarm: null };
      const roster = Option.getOrUndefined(decodeRawRoster(membersFile.text));
      if (!roster) return { swarm: null };
      const rawMembers = roster.members ?? {};
      const names = Object.keys(rawMembers);

      const [boardFile, planFile, transcriptEntries] = await Promise.all([
        readManagedFileBounded(
          profileRoot,
          [...swarmSegments, "board.jsonl"],
          BOARD_MAX_BYTES,
          true,
        ),
        readManagedFileBounded(profileRoot, [...swarmSegments, "plan.json"], PLAN_MAX_BYTES, false),
        Promise.all(
          names.map(async (name) => {
            const convId = rawMembers[name]?.conversation_id ?? "";
            return [name, await summarizeMemberTranscript(profileRoot, convId)] as const;
          }),
        ),
      ]);

      const transcripts = new Map(transcriptEntries);
      const tailLimit = Math.min(MAX_MESSAGE_TAIL, Math.max(1, input.tail ?? DEFAULT_MESSAGE_TAIL));

      const failures = new Map(
        names.map((name) => [name, memberFailureOf(transcripts.get(name) ?? NO_TRANSCRIPT, now)]),
      );
      const stuckSignature = names
        .map((name) => {
          const failure = failures.get(name);
          const tr = transcripts.get(name) ?? NO_TRANSCRIPT;
          const stuck = tr.mtime > 0 && now - tr.mtime > STUCK_MS ? "s" : "";
          return `${name}:${tr.key}:${failure?.kind ?? ""}${stuck}`;
        })
        .join(",");
      const etag = `${input.rootSessionId}|${membersFile.mtimeMs}:${membersFile.size}|${boardFile?.mtimeMs ?? 0}:${boardFile?.size ?? 0}|${planFile?.mtimeMs ?? 0}:${planFile?.size ?? 0}|${tailLimit}|${stuckSignature}`;
      if (input.etag !== undefined && input.etag === etag) {
        return { swarm: null, unchanged: true, etag };
      }

      const allMessages: Array<SwarmMessage> = [];
      const postStats = new Map<
        string,
        { posts: number; lastPostSeq: number; lastPostTime: string }
      >();
      const channelsByName = new Map<string, SwarmChannel>();

      if (boardFile) {
        for (const line of boardFile.text.split("\n")) {
          if (!line.trim()) continue;
          const raw = Option.getOrUndefined(decodeRawBoardMessage(line));
          if (!raw) continue;
          const seq = nonNegativeInt(raw.seq ?? allMessages.length + 1);
          const agent = raw.agent ?? "";
          const text = raw.text ?? "";
          const time = raw.time ?? "";
          const channel = raw.channel && raw.channel !== "main" ? raw.channel : undefined;
          const isControl =
            raw.control === true ||
            raw.kind === "channel_create" ||
            raw.kind === "channel_archive" ||
            raw.kind === "channel_subscribe" ||
            raw.kind === "channel_unsubscribe";

          if (channel && !channelsByName.has(channel)) {
            channelsByName.set(channel, {
              name: channel,
              topic: raw.topic ?? "",
              createdBy: agent,
              archived: raw.kind === "channel_archive",
            });
          } else if (channel && raw.kind === "channel_archive") {
            const existing = channelsByName.get(channel);
            if (existing) channelsByName.set(channel, { ...existing, archived: true });
          }

          const parsedMentions = extractMentions(text, names);
          allMessages.push({
            seq,
            agent,
            text,
            time,
            ...(raw.kind ? { kind: raw.kind } : {}),
            ...(channel ? { channel } : {}),
            mentions: parsedMentions.mentions,
            ...(parsedMentions.mentionChannels.length > 0
              ? { mentionChannels: parsedMentions.mentionChannels }
              : {}),
            all: parsedMentions.all,
            ...(isControl ? { control: true } : {}),
          });

          if (!isControl && agent) {
            const prev = postStats.get(agent) ?? { posts: 0, lastPostSeq: 0, lastPostTime: "" };
            postStats.set(agent, {
              posts: prev.posts + 1,
              lastPostSeq: Math.max(prev.lastPostSeq, seq),
              lastPostTime: time || prev.lastPostTime,
            });
          }
        }
      }

      for (const name of names) {
        for (const ch of rawMembers[name]?.channels ?? []) {
          if (ch && ch !== "main" && ch !== "*" && !channelsByName.has(ch)) {
            channelsByName.set(ch, { name: ch, topic: "", createdBy: "", archived: false });
          }
        }
      }

      const head =
        allMessages.length > 0
          ? (allMessages[allMessages.length - 1]?.seq ?? allMessages.length)
          : 0;
      const coordinatorMember =
        names.find((name) => rawMembers[name]?.conversation_id === input.rootSessionId) ??
        (rawMembers.coordinator ? "coordinator" : null);

      const members: Array<SwarmMember> = names.map((name) => {
        const raw = rawMembers[name]!;
        const tr = transcripts.get(name) ?? NO_TRANSCRIPT;
        const lastReadSeq = nonNegativeInt(raw.last_read_seq);
        const status = memberStatusOf(raw, tr);
        const stats = postStats.get(name) ?? { posts: 0, lastPostSeq: 0, lastPostTime: "" };
        const model = raw.model || raw.applied_model || raw.desired_model || "";
        return {
          name,
          conversationId: raw.conversation_id ?? "",
          role: roleOf(name, raw),
          roleWorker: isRoleWorker(name, raw),
          model,
          status,
          wakeMode: raw.wake_mode ?? "",
          waitSince: nonNegativeInt(raw.wait_since),
          lastReadSeq,
          unread: Math.max(0, head - lastReadSeq),
          killed: status === "killed",
          steps: tr.steps,
          activity: status === "working" ? tr.activity : "",
          activityKind: status === "working" ? tr.activityKind : "",
          posts: stats.posts,
          lastPostSeq: stats.lastPostSeq,
          lastPostTime: stats.lastPostTime,
          ...(raw.workspace_mode ? { workspaceMode: raw.workspace_mode } : {}),
          ...(raw.channels && raw.channels.length > 0 ? { channels: [...raw.channels] } : {}),
          failure: failures.get(name) ?? null,
          transcriptMtime: tr.mtime,
        };
      });

      members.sort(
        (left, right) =>
          (left.role === "coordinator" ? 0 : 1) - (right.role === "coordinator" ? 0 : 1) ||
          left.name.localeCompare(right.name),
      );

      const systemAttention: Array<SwarmSystemAlert> = [];
      for (const member of members) {
        if (member.killed) continue;
        if (member.failure) {
          systemAttention.push({
            id: `${member.failure.kind}:${member.name}`,
            kind: member.failure.kind,
            member: member.name,
            conversationId: member.conversationId,
            text:
              member.failure.kind === "quota"
                ? `${member.name} hit quota limits`
                : `${member.name} stopped on an error`,
            detail: member.failure.text,
            since: member.transcriptMtime,
          });
        } else if (
          member.status === "working" &&
          member.transcriptMtime > 0 &&
          now - member.transcriptMtime > STUCK_MS
        ) {
          systemAttention.push({
            id: `stuck:${member.name}`,
            kind: "stuck",
            member: member.name,
            conversationId: member.conversationId,
            text: `${member.name} has had no transcript activity for over 10m`,
            detail: member.activity || "Waiting on current step",
            since: member.transcriptMtime,
          });
        }
      }

      const selfMember = coordinatorMember
        ? members.find((candidate) => candidate.name === coordinatorMember)
        : undefined;
      const firstUnreadSeq = selfMember
        ? (allMessages.find(
            (message) =>
              !message.control &&
              message.seq > selfMember.lastReadSeq &&
              message.agent !== selfMember.name,
          )?.seq ?? 0)
        : 0;

      const totalMessages = allMessages.length;
      const messagesOffset = totalMessages > tailLimit ? totalMessages - tailLimit : 0;
      const messages = messagesOffset > 0 ? allMessages.slice(messagesOffset) : allMessages;

      const plan = planFile ? parsePlan(planFile.text) : null;
      const title = roster.title?.trim() || plan?.goal?.title || "Swarm";

      return {
        swarm: {
          swarmId: input.rootSessionId,
          title,
          member: coordinatorMember,
          etag,
          head,
          members,
          messages,
          totalMessages,
          messagesOffset,
          channels: [...channelsByName.values()].sort((a, b) => a.name.localeCompare(b.name)),
          plan,
          systemAttention,
          unseenSeqs: [],
          firstUnreadSeq,
        },
        etag,
      };
    },
    catch: (cause) => new AntigravitySwarmReadError({ cause }),
  });
});

export const readAntigravitySwarmMemberTranscript = Effect.fn(
  "readAntigravitySwarmMemberTranscript",
)(function* (input: {
  readonly profileDirectory: string;
  readonly rootSessionId: string;
  readonly memberName: string;
}) {
  if (!NATIVE_ID.test(input.rootSessionId)) {
    return {
      memberName: input.memberName,
      conversationId: "",
      steps: null,
      truncated: false,
    } satisfies OrchestrationV2GetSwarmMemberTranscriptResult;
  }
  return yield* Effect.tryPromise({
    try: async (): Promise<OrchestrationV2GetSwarmMemberTranscriptResult> => {
      const profileRoot = await antigravityProfileRoot(input.profileDirectory);
      if (profileRoot === undefined) {
        return {
          memberName: input.memberName,
          conversationId: "",
          steps: null,
          truncated: false,
        };
      }
      const membersFile = await readManagedFileBounded(
        profileRoot,
        [
          "antigravity-acp",
          "brain",
          input.rootSessionId,
          ".system_generated",
          "swarm",
          "members.json",
        ],
        MEMBERS_MAX_BYTES,
        false,
      );
      if (!membersFile) {
        return {
          memberName: input.memberName,
          conversationId: "",
          steps: null,
          truncated: false,
        };
      }
      const roster = Option.getOrUndefined(decodeRawRoster(membersFile.text));
      const member = roster?.members?.[input.memberName];
      const conversationId = member?.conversation_id ?? "";
      if (!NATIVE_ID.test(conversationId)) {
        return {
          memberName: input.memberName,
          conversationId,
          steps: null,
          truncated: false,
        };
      }
      const transcriptFile = await readManagedFileBounded(
        profileRoot,
        [
          "antigravity-acp",
          "brain",
          conversationId,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        ],
        TRANSCRIPT_DETAIL_TAIL_BYTES,
        true,
      );
      if (!transcriptFile) {
        return {
          memberName: input.memberName,
          conversationId,
          steps: null,
          truncated: false,
        };
      }
      return {
        memberName: input.memberName,
        conversationId,
        steps: parseTranscriptSteps(transcriptFile.text),
        truncated: transcriptFile.truncated,
      };
    },
    catch: (cause) => new AntigravitySwarmReadError({ cause }),
  });
});
