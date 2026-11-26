import {
  MessageId,
  ProviderInstanceId,
  RunId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import {
  v2MessageRow,
  v2Now,
  v2Projection,
  v2ThreadId,
} from "../state/orchestrationV2TestFixtures.ts";
import {
  EMPTY_ENVIRONMENT_THREAD_STATE,
  type EnvironmentThreadState,
} from "../state/threadState.ts";
import { projectMissionControlActivity } from "./missionControlActivity.ts";

const runId = RunId.make("run");
function message(text: string, ordinal: number) {
  const item = v2MessageRow(text, ordinal).item;
  if (item.type !== "user_message") throw new Error("Expected a user message fixture");
  return item;
}
const base = message("Question", 0);

function state(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  running = true,
): EnvironmentThreadState {
  return {
    ...EMPTY_ENVIRONMENT_THREAD_STATE,
    status: "live",
    data: Option.some({
      ...v2Projection,
      runs: [
        {
          id: runId,
          threadId: v2ThreadId,
          ordinal: 0,
          providerInstanceId: ProviderInstanceId.make("codex"),
          modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test" },
          providerThreadId: null,
          userMessageId: MessageId.make("question"),
          rootNodeId: null,
          activeAttemptId: null,
          status: running ? "running" : "completed",
          requestedAt: v2Now,
          startedAt: v2Now,
          completedAt: running ? null : v2Now,
          checkpointId: null,
          contextHandoffId: null,
        },
      ],
      visibleTurnItems: items.map((item, position) => ({
        position,
        visibility: "local",
        sourceThreadId: v2ThreadId,
        sourceItemId: item.id,
        item,
      })),
    }),
  };
}

describe("Mission Control live activity", () => {
  it("tracks streamed text and command completion in workspace order without duplicate rows", () => {
    const assistant: OrchestrationV2TurnItem = {
      ...base,
      type: "assistant_message",
      id: TurnItemId.make("assistant"),
      messageId: MessageId.make("assistant"),
      runId,
      status: "running",
      text: "Checking",
      streaming: true,
    };
    const command: OrchestrationV2TurnItem = {
      ...base,
      id: TurnItemId.make("command"),
      type: "command_execution",
      runId,
      input: "vp test run activity.test.ts",
      status: "running",
      output: "Starting tests",
    };
    const initial = projectMissionControlActivity(v2ThreadId, state([base, assistant, command]));
    expect(initial.running).toBe(true);
    expect(initial.entries.map((entry) => entry.kind)).toEqual(["user", "assistant", "tool"]);
    const next = projectMissionControlActivity(
      v2ThreadId,
      state(
        [
          base,
          {
            ...assistant,
            text: "Checking the activity feed",
            streaming: false,
            status: "completed",
          },
          { ...command, output: "Tests passed", status: "completed", exitCode: 0 },
        ],
        false,
      ),
    );
    expect(next.entries.map((entry) => entry.id)).toEqual(initial.entries.map((entry) => entry.id));
    expect(next.entries[1]?.body).toBe("Checking the activity feed");
    expect(next.entries[2]).toMatchObject({
      status: "completed",
      body: "vp test run activity.test.ts\n\nTests passed",
    });
    expect(next.running).toBe(false);
    expect(next.status).toBe("live");
    const failed = projectMissionControlActivity(v2ThreadId, {
      ...state([assistant]),
      error: Option.some("Disconnected"),
    });
    expect(failed.status).toBe("error");
    expect(failed.running).toBe(false);
    const stopped = projectMissionControlActivity(v2ThreadId, state([command], false));
    expect(stopped.entries[0]?.status).toBe("completed");
    const failedCommand = projectMissionControlActivity(
      v2ThreadId,
      state([{ ...command, status: "completed", exitCode: 1, outputOmitted: true }], false),
    );
    expect(failedCommand.entries[0]?.status).toBe("failed");
    expect(failedCommand.truncated).toBe(true);
    const structured: OrchestrationV2TurnItem = {
      ...command,
      type: "dynamic_tool",
      toolName: "search",
      input: { query: "activity feed" },
      output: { content: [{ type: "text", text: "Found activity" }] },
    };
    expect(
      projectMissionControlActivity(v2ThreadId, state([structured])).entries[0]?.body,
    ).toContain("Found activity");
    expect(projectMissionControlActivity(v2ThreadId, EMPTY_ENVIRONMENT_THREAD_STATE)).toMatchObject(
      { status: "loading", running: false, entries: [] },
    );
  });

  it("bounds recent history and long outputs while retaining their live tail", () => {
    const rows = Array.from({ length: 100 }, (_, index) => message(`Message ${index}`, index));
    const snapshot = projectMissionControlActivity(v2ThreadId, state(rows));
    expect(snapshot.entries).toHaveLength(80);
    expect(snapshot.entries[0]?.body).toBe("Message 20");
    expect(snapshot.entries.at(-1)?.body).toBe("Message 99");
    expect(snapshot.truncated).toBe(true);
    const large = projectMissionControlActivity(
      v2ThreadId,
      state(
        rows.map((item) => ({
          ...item,
          type: "reasoning",
          text: "x".repeat(10_000) + "latest text",
          streaming: true,
        })),
      ),
    );
    expect(large.entries.length).toBeLessThan(80);
    expect(large.entries.at(-1)?.body.endsWith("latest text")).toBe(true);
    expect(large.entries.every((entry) => entry.body.length <= 2_048)).toBe(true);
    expect(JSON.stringify(large).length).toBeLessThan(40_000);
    expect(large.truncated).toBe(true);
  });
});
