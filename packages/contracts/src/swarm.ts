import * as Schema from "effect/Schema";

import { NonNegativeInt, PositiveInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export const SwarmMemberStatus = Schema.Literals(["working", "waiting", "killed"]);
export type SwarmMemberStatus = typeof SwarmMemberStatus.Type;

export const SwarmMemberFailure = Schema.Struct({
  kind: Schema.Literals(["error", "quota"]),
  text: Schema.String,
});
export type SwarmMemberFailure = typeof SwarmMemberFailure.Type;

export const SwarmMember = Schema.Struct({
  name: Schema.String,
  conversationId: Schema.String,
  role: Schema.String,
  roleWorker: Schema.Boolean,
  model: Schema.String,
  status: SwarmMemberStatus,
  wakeMode: Schema.String,
  waitSince: NonNegativeInt,
  lastReadSeq: NonNegativeInt,
  unread: NonNegativeInt,
  killed: Schema.Boolean,
  steps: NonNegativeInt,
  activity: Schema.String,
  activityKind: Schema.Literals(["tool", "thinking", ""]),
  posts: NonNegativeInt,
  lastPostSeq: NonNegativeInt,
  lastPostTime: Schema.String,
  workspaceMode: Schema.optional(Schema.String),
  channels: Schema.optional(Schema.Array(Schema.String)),
  failure: Schema.NullOr(SwarmMemberFailure),
  transcriptMtime: NonNegativeInt,
});
export type SwarmMember = typeof SwarmMember.Type;

export const SwarmChannel = Schema.Struct({
  name: Schema.String,
  topic: Schema.String,
  createdBy: Schema.String,
  archived: Schema.Boolean,
});
export type SwarmChannel = typeof SwarmChannel.Type;

export const SwarmMessage = Schema.Struct({
  seq: NonNegativeInt,
  agent: Schema.String,
  text: Schema.String,
  time: Schema.String,
  kind: Schema.optional(Schema.String),
  channel: Schema.optional(Schema.String),
  mentions: Schema.Array(Schema.String),
  mentionChannels: Schema.optional(Schema.Array(Schema.String)),
  all: Schema.Boolean,
  control: Schema.optional(Schema.Boolean),
});
export type SwarmMessage = typeof SwarmMessage.Type;

export const SwarmPlanGoal = Schema.Struct({
  title: Schema.String,
  line: Schema.String,
});
export type SwarmPlanGoal = typeof SwarmPlanGoal.Type;

export const SwarmPlanThread = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  goal: Schema.String,
  tasks: Schema.Array(Schema.String),
});
export type SwarmPlanThread = typeof SwarmPlanThread.Type;

export const SwarmPlan = Schema.Struct({
  goal: Schema.NullOr(SwarmPlanGoal),
  tasks: Schema.Record(Schema.String, Schema.String),
  threads: Schema.Array(SwarmPlanThread),
});
export type SwarmPlan = typeof SwarmPlan.Type;

export const SwarmSystemAlert = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["error", "quota", "stuck"]),
  member: Schema.String,
  conversationId: Schema.String,
  text: Schema.String,
  detail: Schema.String,
  since: NonNegativeInt,
});
export type SwarmSystemAlert = typeof SwarmSystemAlert.Type;

export const SwarmSnapshot = Schema.Struct({
  swarmId: Schema.String,
  title: Schema.String,
  member: Schema.NullOr(Schema.String),
  etag: Schema.String,
  head: NonNegativeInt,
  members: Schema.Array(SwarmMember),
  messages: Schema.Array(SwarmMessage),
  totalMessages: NonNegativeInt,
  messagesOffset: NonNegativeInt,
  channels: Schema.Array(SwarmChannel),
  plan: Schema.NullOr(SwarmPlan),
  systemAttention: Schema.Array(SwarmSystemAlert),
  unseenSeqs: Schema.Array(NonNegativeInt),
  firstUnreadSeq: NonNegativeInt,
});
export type SwarmSnapshot = typeof SwarmSnapshot.Type;

export const SwarmMemberTranscriptStep = Schema.Struct({
  index: NonNegativeInt,
  type: Schema.String,
  status: Schema.NullOr(Schema.String),
  text: Schema.NullOr(Schema.String),
  toolCalls: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      input: Schema.String,
    }),
  ),
});
export type SwarmMemberTranscriptStep = typeof SwarmMemberTranscriptStep.Type;

export const OrchestrationV2GetSwarmBoardInput = Schema.Struct({
  threadId: ThreadId,
  etag: Schema.optional(Schema.String),
  tail: Schema.optional(PositiveInt),
});
export type OrchestrationV2GetSwarmBoardInput = typeof OrchestrationV2GetSwarmBoardInput.Type;

export const OrchestrationV2GetSwarmBoardResult = Schema.Struct({
  swarm: Schema.NullOr(SwarmSnapshot),
  unchanged: Schema.optional(Schema.Boolean),
  etag: Schema.optional(Schema.String),
});
export type OrchestrationV2GetSwarmBoardResult = typeof OrchestrationV2GetSwarmBoardResult.Type;

export class OrchestrationV2GetSwarmBoardError extends Schema.TaggedError<OrchestrationV2GetSwarmBoardError>()(
  "OrchestrationV2GetSwarmBoardError",
  {
    threadId: ThreadId,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Failed to read the swarm board.";
  }
}

export const OrchestrationV2GetSwarmMemberTranscriptInput = Schema.Struct({
  threadId: ThreadId,
  memberName: TrimmedNonEmptyString,
});
export type OrchestrationV2GetSwarmMemberTranscriptInput =
  typeof OrchestrationV2GetSwarmMemberTranscriptInput.Type;

export const OrchestrationV2GetSwarmMemberTranscriptResult = Schema.Struct({
  memberName: Schema.String,
  conversationId: Schema.String,
  steps: Schema.NullOr(Schema.Array(SwarmMemberTranscriptStep)),
  truncated: Schema.Boolean,
});
export type OrchestrationV2GetSwarmMemberTranscriptResult =
  typeof OrchestrationV2GetSwarmMemberTranscriptResult.Type;

export class OrchestrationV2GetSwarmMemberTranscriptError extends Schema.TaggedError<OrchestrationV2GetSwarmMemberTranscriptError>()(
  "OrchestrationV2GetSwarmMemberTranscriptError",
  {
    threadId: ThreadId,
    memberName: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return "Failed to read the swarm member transcript.";
  }
}
