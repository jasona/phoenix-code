// @effect-diagnostics nodeBuiltinImport:off -- test writes temporary native swarm fixtures directly.
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import {
  readAntigravitySwarmBoard,
  readAntigravitySwarmMemberTranscript,
} from "./AntigravitySwarm.ts";

const ROOT_SESSION = "ae03f033-05ef-4298-b1f0-b3dbd953c18c";
const WORKER_A = "6c03058c-123a-4a81-8bdb-93f4f13ab847";
const WORKER_B = "7d14069d-234b-5b92-9cec-a4e5e24bc958";
const MONITOR_ID = "8e2517ae-345c-6ca3-adfd-b5f6f35cd069";

async function writeSwarmFixture(baseDir: string) {
  const swarmDir = NodePath.join(
    baseDir,
    "antigravity-acp",
    "brain",
    ROOT_SESSION,
    ".system_generated",
    "swarm",
  );
  await NodeFSP.mkdir(swarmDir, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(swarmDir, "members.json"),
    JSON.stringify({
      title: "Parser rewrite",
      members: {
        coordinator: {
          conversation_id: ROOT_SESSION,
          role: "coordinator",
          model: "gemini-4-neon-high",
          wake_mode: "mentions",
          last_read_seq: 1,
          killed: false,
        },
        backend: {
          conversation_id: WORKER_A,
          role: "worker",
          model: "gemini-4-neon-high",
          wake_mode: "working",
          last_read_seq: 2,
          killed: false,
          workspace_mode: "share",
          channels: ["api"],
        },
        verifier: {
          conversation_id: WORKER_B,
          role: "worker",
          model: "gemini-4-neon-high",
          wake_mode: "mentions",
          last_read_seq: 3,
          killed: false,
        },
        monitor: {
          conversation_id: MONITOR_ID,
          role: "monitor",
          model: "gemini-4-neon-high",
          wake_mode: "mentions",
          last_read_seq: 3,
          killed: false,
        },
        retired: {
          conversation_id: "9f3628bf-456d-7db4-befe-c6a7a46de170",
          role: "worker",
          model: "gemini-4-neon-high",
          killed: true,
        },
      },
    }),
  );

  await NodeFSP.writeFile(
    NodePath.join(swarmDir, "board.jsonl"),
    [
      JSON.stringify({
        seq: 1,
        agent: "coordinator",
        text: "@backend implement the SQLite store",
        time: "2026-11-26 21:46:52",
        kind: "brief",
        channel: "api",
      }),
      JSON.stringify({
        seq: 2,
        agent: "backend",
        text: "@coordinator @verifier [done] SQLite store ready, see #1",
        time: "2026-11-26 21:48:10",
        channel: "api",
      }),
      JSON.stringify({
        seq: 3,
        agent: "verifier",
        text: "@all tests pass after #2",
        time: "2026-11-26 21:49:00",
      }),
    ].join("\n") + "\n",
  );

  await NodeFSP.writeFile(
    NodePath.join(swarmDir, "plan.json"),
    JSON.stringify({
      goal: { title: "Ship parser rewrite", line: "Build, test, and verify." },
      tasks: { backend: "Implement SQLite store", verifier: "Run integration tests" },
      threads: [
        {
          id: "t-core",
          title: "Core storage",
          goal: "Land backend and tests.",
          tasks: ["backend", "verifier"],
        },
      ],
    }),
  );

  // Active worker transcript (mid-turn tool call)
  const workerALogs = NodePath.join(
    baseDir,
    "antigravity-acp",
    "brain",
    WORKER_A,
    ".system_generated",
    "logs",
  );
  await NodeFSP.mkdir(workerALogs, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(workerALogs, "transcript.jsonl"),
    [
      JSON.stringify({ step_index: 0, type: "USER_INPUT", content: "Start working" }),
      JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        thinking: "**Checking SQLite schema**\nReviewing columns",
        tool_calls: [
          {
            name: "run_command",
            args: { toolSummary: '"Run backend unit tests"' },
          },
        ],
      }),
    ].join("\n") + "\n",
  );

  // Waiting worker transcript (parked in swarm_wait DONE)
  const workerBLogs = NodePath.join(
    baseDir,
    "antigravity-acp",
    "brain",
    WORKER_B,
    ".system_generated",
    "logs",
  );
  await NodeFSP.mkdir(workerBLogs, { recursive: true });
  await NodeFSP.writeFile(
    NodePath.join(workerBLogs, "transcript.jsonl"),
    [
      JSON.stringify({
        step_index: 0,
        type: "PLANNER_RESPONSE",
        tool_calls: [{ name: "swarm_wait", args: { since: "3" } }],
      }),
      JSON.stringify({ step_index: 1, type: "GENERIC", status: "DONE" }),
    ].join("\n") + "\n",
  );
}

describe("AntigravitySwarm", () => {
  it.live("reads roster, board, plan, live transcript status, etag, and member transcript", () =>
    Effect.gen(function* () {
      const tempDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-swarm-test-")),
      );
      try {
        yield* Effect.promise(() => writeSwarmFixture(tempDir));

        const first = yield* readAntigravitySwarmBoard({
          profileDirectory: tempDir,
          rootSessionId: ROOT_SESSION,
        });
        expect(first.unchanged).toBeUndefined();
        expect(first.swarm).not.toBeNull();
        const swarm = first.swarm!;

        expect(swarm.title).toBe("Parser rewrite");
        expect(swarm.member).toBe("coordinator");
        expect(swarm.head).toBe(3);
        expect(swarm.firstUnreadSeq).toBe(2);
        expect(swarm.channels.map((c) => c.name)).toEqual(["api"]);
        expect(swarm.plan?.goal?.title).toBe("Ship parser rewrite");
        expect(swarm.plan?.threads).toHaveLength(1);

        const backend = swarm.members.find((m) => m.name === "backend")!;
        expect(backend.status).toBe("working");
        expect(backend.activity).toBe("Run backend unit tests");
        expect(backend.activityKind).toBe("tool");
        expect(backend.steps).toBe(2);
        expect(backend.posts).toBe(1);
        expect(backend.unread).toBe(1);
        expect(backend.workspaceMode).toBe("share");

        const verifier = swarm.members.find((m) => m.name === "verifier")!;
        expect(verifier.status).toBe("waiting");
        expect(verifier.activity).toBe("");

        const monitor = swarm.members.find((m) => m.name === "monitor")!;
        expect(monitor.roleWorker).toBe(true);

        const retired = swarm.members.find((m) => m.name === "retired")!;
        expect(retired.status).toBe("killed");
        expect(retired.killed).toBe(true);

        expect(swarm.messages[1]?.mentions).toEqual(["coordinator", "verifier"]);
        expect(swarm.messages[2]?.all).toBe(true);

        // Etag hit returns unchanged without re-serializing payload.
        const second = yield* readAntigravitySwarmBoard({
          profileDirectory: tempDir,
          rootSessionId: ROOT_SESSION,
          etag: first.etag,
        });
        expect(second.unchanged).toBe(true);
        expect(second.swarm).toBeNull();

        // Member read-only transcript reads bounded steps.
        const transcript = yield* readAntigravitySwarmMemberTranscript({
          profileDirectory: tempDir,
          rootSessionId: ROOT_SESSION,
          memberName: "backend",
        });
        expect(transcript.conversationId).toBe(WORKER_A);
        expect(transcript.steps).toHaveLength(2);
        expect(transcript.steps?.[1]?.toolCalls[0]?.name).toBe("run_command");
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(tempDir, { recursive: true, force: true }));
      }
    }),
  );

  it.live("surfaces quota errors and stuck alerts in systemAttention", () =>
    Effect.gen(function* () {
      const tempDir = yield* Effect.promise(() =>
        NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "t3-swarm-alert-")),
      );
      try {
        yield* Effect.promise(() => writeSwarmFixture(tempDir));
        const workerBTranscript = NodePath.join(
          tempDir,
          "antigravity-acp",
          "brain",
          WORKER_B,
          ".system_generated",
          "logs",
          "transcript.jsonl",
        );
        yield* Effect.promise(() =>
          NodeFSP.writeFile(
            workerBTranscript,
            JSON.stringify({
              step_index: 2,
              type: "ERROR_MESSAGE",
              error: "429 RESOURCE_EXHAUSTED: quota exceeded",
            }) + "\n",
          ),
        );

        const farFuture = 3_000_000_000_000;
        const result = yield* readAntigravitySwarmBoard({
          profileDirectory: tempDir,
          rootSessionId: ROOT_SESSION,
          nowMs: farFuture,
        });
        const alerts = result.swarm?.systemAttention ?? [];
        expect(alerts.some((alert) => alert.member === "verifier" && alert.kind === "quota")).toBe(
          true,
        );
        expect(alerts.some((alert) => alert.member === "backend" && alert.kind === "stuck")).toBe(
          true,
        );
      } finally {
        yield* Effect.promise(() => NodeFSP.rm(tempDir, { recursive: true, force: true }));
      }
    }),
  );
});
