import type { SwarmMember, SwarmMessage, SwarmSnapshot } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  countSwarmMembers,
  deriveSwarmWorkstreams,
  filterSwarmMessages,
  groupSwarmMessages,
  parseSwarmMessageSegments,
  sortSwarmMembers,
} from "./swarmBoard.ts";

function makeMember(overrides: Partial<SwarmMember> & { name: string }): SwarmMember {
  return {
    conversationId: "conv-1",
    role: "worker",
    roleWorker: false,
    model: "gemini-4-neon",
    status: "waiting",
    wakeMode: "mentions",
    waitSince: 0,
    lastReadSeq: 0,
    unread: 0,
    killed: false,
    steps: 0,
    activity: "",
    activityKind: "",
    posts: 0,
    lastPostSeq: 0,
    lastPostTime: "",
    failure: null,
    transcriptMtime: 0,
    ...overrides,
  };
}

function makeMessage(
  overrides: Partial<SwarmMessage> & { seq: number; agent: string },
): SwarmMessage {
  return {
    text: "hello",
    time: "2026-11-26 21:00:00",
    mentions: [],
    all: false,
    ...overrides,
  };
}

describe("swarmBoard client-runtime helpers", () => {
  it("sorts active before waiting before killed and coordinator first", () => {
    const members = [
      makeMember({ name: "zeta", status: "killed", killed: true }),
      makeMember({ name: "beta", status: "waiting" }),
      makeMember({ name: "alpha", status: "working" }),
      makeMember({ name: "coordinator", role: "coordinator", status: "working" }),
    ];
    expect(sortSwarmMembers(members).map((m) => m.name)).toEqual([
      "coordinator",
      "alpha",
      "beta",
      "zeta",
    ]);
  });

  it("counts task workers while excluding role workers", () => {
    const counts = countSwarmMembers([
      makeMember({ name: "coordinator", role: "coordinator", status: "waiting" }),
      makeMember({ name: "worker-1", status: "working" }),
      makeMember({ name: "monitor", role: "monitor", roleWorker: true, status: "working" }),
      makeMember({ name: "old", status: "killed", killed: true }),
    ]);
    expect(counts).toEqual({ active: 1, waiting: 1, killed: 1, total: 3 });
  });

  it("filters and groups board messages within 10-minute windows", () => {
    const messages = [
      makeMessage({
        seq: 1,
        agent: "backend",
        text: "first",
        time: "2026-11-26 21:00:00",
        channel: "api",
      }),
      makeMessage({
        seq: 2,
        agent: "backend",
        text: "@coordinator second",
        time: "2026-11-26 21:05:00",
        mentions: ["coordinator"],
        channel: "api",
      }),
      makeMessage({
        seq: 3,
        agent: "backend",
        text: "later",
        time: "2026-11-26 21:25:00",
        channel: "api",
      }),
      makeMessage({
        seq: 4,
        agent: "verifier",
        text: "@all done",
        time: "2026-11-26 21:26:00",
        all: true,
      }),
    ];

    const apiOnly = filterSwarmMessages(messages, {
      search: "",
      fromAgent: "",
      toMember: "",
      channel: "api",
      hiddenAgents: new Set(),
    });
    expect(apiOnly.map((m) => m.seq)).toEqual([1, 2, 3]);

    const groups = groupSwarmMessages(apiOnly, "coordinator");
    expect(groups).toHaveLength(2);
    expect(groups[0]?.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(groups[0]?.mentionsSelf).toBe(true);
    expect(groups[1]?.messages.map((m) => m.seq)).toEqual([3]);
  });

  it("parses @mentions, @#channels, and valid #seq citations", () => {
    const segments = parseSwarmMessageSegments("Check @verifier and @#api on #2 (not #99)", 10);
    expect(segments.map(({ offset: _offset, ...rest }) => rest)).toEqual([
      { kind: "text", value: "Check " },
      { kind: "mention", value: "@verifier", target: "verifier" },
      { kind: "text", value: " and " },
      { kind: "channel", value: "@#api", channel: "api" },
      { kind: "text", value: " on " },
      { kind: "seq", value: "#2", seq: 2 },
      { kind: "text", value: " (not " },
      { kind: "text", value: "#99" },
      { kind: "text", value: ")" },
    ]);
  });

  it("derives workstreams from plan.threads plus unassigned workers", () => {
    const snapshot: SwarmSnapshot = {
      swarmId: "s-1",
      title: "Demo",
      member: "coordinator",
      etag: "e1",
      head: 1,
      members: [
        makeMember({ name: "coordinator", role: "coordinator", status: "waiting" }),
        makeMember({ name: "backend", status: "working" }),
        makeMember({ name: "extra", status: "waiting" }),
      ],
      messages: [],
      totalMessages: 0,
      messagesOffset: 0,
      channels: [],
      plan: {
        goal: { title: "Ship demo", line: "Fast" },
        tasks: { backend: "API" },
        threads: [{ id: "t1", title: "Backend", goal: "Build API", tasks: ["backend"] }],
      },
      systemAttention: [],
      unseenSeqs: [],
      firstUnreadSeq: 0,
    };

    const { workstreams, unassignedMembers } = deriveSwarmWorkstreams(snapshot);
    expect(workstreams).toHaveLength(1);
    expect(workstreams[0]?.activeCount).toBe(1);
    expect(unassignedMembers.map((m) => m.name)).toEqual(["extra"]);
  });
});
