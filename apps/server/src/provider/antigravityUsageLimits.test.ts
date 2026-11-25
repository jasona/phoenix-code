import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import * as NodeFileSystem from "@effect/platform-node/NodeFileSystem";
import * as NodePath from "@effect/platform-node/NodePath";

import {
  makeAntigravityUsageProbe,
  parseAntigravityCliUsageOutput,
} from "./antigravityUsageLimits.ts";

const makeMockSpawner = (
  handler: (command: ChildProcess.Command) => {
    readonly stdout?: string;
    readonly stderr?: string;
    readonly exitCode?: number;
  },
) =>
  ChildProcessSpawner.make((command) =>
    Effect.sync(() => {
      const result = handler(command);
      const encode = (text: string | undefined) =>
        text ? Stream.make(new TextEncoder().encode(text)) : Stream.empty;
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(4242),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.exitCode ?? 0)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        unref: Effect.void,
        stdin: Stream.drain as never,
        stdout: encode(result.stdout),
        stderr: encode(result.stderr),
        all: encode(result.stdout),
        getInputFd: () => Stream.drain as never,
        getOutputFd: () => Stream.empty,
      });
    }),
  );

const SAMPLE_CLI_OUTPUT = JSON.stringify({
  conversation_id: "",
  status: "SUCCESS",
  response: "",
  duration_seconds: 0,
  num_turns: 0,
  usage: {
    input_tokens: 0,
    output_tokens: 0,
    thinking_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
  },
  command: {
    name: "usage",
    data: {
      groups: [
        {
          name: "Gemini Models",
          buckets: [
            {
              id: "gemini-weekly",
              name: "Weekly Limit Remaining",
              description: "You have used some of your weekly limit.",
              window: "weekly",
              remaining_fraction: 0.72,
              reset_time: "2026-12-01T05:26:46Z",
            },
            {
              id: "gemini-5h",
              name: "Five Hour Limit Remaining",
              description: "You have used some of your 5-hour limit.",
              window: "5h",
              remaining_fraction: 0.8,
              reset_time: "2026-11-25T14:45:52Z",
            },
          ],
        },
        {
          name: "Claude and GPT models",
          buckets: [
            {
              id: "3p-weekly",
              name: "Weekly Limit Remaining",
              window: "weekly",
              remaining_fraction: 1,
              reset_time: "1970-01-01T00:00:00Z",
            },
            {
              id: "3p-5h",
              name: "Five Hour Limit Remaining",
              window: "5h",
              remaining_fraction: 1,
              reset_time: "1970-01-01T00:00:00Z",
            },
          ],
        },
      ],
    },
  },
});

const TestFsLayer = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer);

describe("parseAntigravityCliUsageOutput", () => {
  it.effect("parses CLI JSON buckets and omits Unix epoch reset times", () =>
    Effect.gen(function* () {
      const windows = yield* parseAntigravityCliUsageOutput(
        SAMPLE_CLI_OUTPUT,
        Date.parse("2026-11-25T10:50:00Z"),
      );
      expect(windows).toEqual([
        {
          id: "gemini-weekly",
          label: "Gemini · Weekly",
          kind: "weekly",
          usedPercent: expect.closeTo(28, 5),
          resetsAt: "2026-12-01T05:26:46.000Z",
          windowDurationMins: 7 * 24 * 60,
        },
        {
          id: "gemini-5h",
          label: "Gemini · 5-hour",
          kind: "session",
          usedPercent: expect.closeTo(20, 5),
          resetsAt: "2026-11-25T14:45:52.000Z",
          windowDurationMins: 5 * 60,
        },
        {
          id: "3p-weekly",
          label: "Claude & GPT (shared) · Weekly",
          kind: "weekly",
          usedPercent: 0,
          windowDurationMins: 7 * 24 * 60,
        },
        {
          id: "3p-5h",
          label: "Claude & GPT (shared) · 5-hour",
          kind: "session",
          usedPercent: 0,
          windowDurationMins: 5 * 60,
        },
      ]);
    }),
  );

  it.effect("extracts JSON even when log lines precede stdout", () =>
    Effect.gen(function* () {
      const windows = yield* parseAntigravityCliUsageOutput(
        `I1125 Starting language server\n${SAMPLE_CLI_OUTPUT}\n`,
        Date.parse("2026-11-25T10:50:00Z"),
      );
      expect(windows).toHaveLength(4);
    }),
  );
});

describe("makeAntigravityUsageProbe", () => {
  it.effect("returns unsupported for API key auth without spawning the CLI", () =>
    Effect.gen(function* () {
      let spawned = false;
      const { probe, clear } = yield* makeAntigravityUsageProbe({
        profileDirectory: "/tmp/nonexistent-antigravity-profile",
        authMethod: "gemini-api-key",
        resolveExecutable: Effect.succeed("/usr/local/bin/agy"),
      }).pipe(
        Effect.provide(TestFsLayer),
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          makeMockSpawner(() => {
            spawned = true;
            return { stdout: SAMPLE_CLI_OUTPUT };
          }),
        ),
      );
      const result = yield* probe;
      expect(spawned).toBe(false);
      expect(result.unavailable?.reason).toBe("unsupported");
      expect(result.windows).toEqual([]);
      yield* clear;
    }),
  );

  it.effect("returns unsupported when the profile has no saved OAuth token", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const profileDirectory = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-antigravity-usage-test-",
      });
      yield* fs.makeDirectory(path.join(profileDirectory, "antigravity-acp"), { recursive: true });

      let spawned = false;
      const { probe } = yield* makeAntigravityUsageProbe({
        profileDirectory,
        authMethod: "oauth-personal",
        resolveExecutable: Effect.succeed("/usr/local/bin/agy"),
      }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          makeMockSpawner(() => {
            spawned = true;
            return { stdout: SAMPLE_CLI_OUTPUT };
          }),
        ),
      );
      const result = yield* probe;
      expect(spawned).toBe(false);
      expect(result.unavailable?.reason).toBe("unsupported");
      expect(result.windows).toEqual([]);
    }).pipe(Effect.scoped, Effect.provide(TestFsLayer)),
  );

  it.effect("spawns agy --print /usage --output-format json and returns parsed windows", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const profileDirectory = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-antigravity-usage-test-",
      });
      const acpDir = path.join(profileDirectory, "antigravity-acp");
      yield* fs.makeDirectory(acpDir, { recursive: true });
      yield* fs.writeFileString(path.join(acpDir, "antigravity-oauth-token"), "{}");

      let capturedCommand: ChildProcess.Command | undefined;
      const { probe } = yield* makeAntigravityUsageProbe({
        profileDirectory,
        authMethod: "oauth-personal",
        baseEnv: { PATH: "/usr/bin", DISPLAY: ":0" },
        resolveExecutable: Effect.succeed("/usr/local/bin/agy"),
      }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          makeMockSpawner((command) => {
            capturedCommand = command;
            return { stdout: SAMPLE_CLI_OUTPUT, exitCode: 0 };
          }),
        ),
      );
      const result = yield* probe;
      expect(capturedCommand).toBeDefined();
      expect(result.unavailable).toBeUndefined();
      expect(result.windows.map((window) => window.id)).toEqual([
        "3p-5h",
        "gemini-5h",
        "3p-weekly",
        "gemini-weekly",
      ]);
      expect(result.windows.find((window) => window.id === "gemini-5h")?.usedPercent).toBeCloseTo(
        20,
        5,
      );
    }).pipe(Effect.scoped, Effect.provide(TestFsLayer)),
  );

  it.effect("reports expired sign-in when agy prompts for authentication", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const profileDirectory = yield* fs.makeTempDirectoryScoped({
        prefix: "t3-antigravity-usage-test-",
      });
      const acpDir = path.join(profileDirectory, "antigravity-acp");
      yield* fs.makeDirectory(acpDir, { recursive: true });
      yield* fs.writeFileString(path.join(acpDir, "antigravity-oauth-token"), "{}");

      const { probe } = yield* makeAntigravityUsageProbe({
        profileDirectory,
        authMethod: "oauth-personal",
        resolveExecutable: Effect.succeed("/usr/local/bin/agy"),
      }).pipe(
        Effect.provideService(
          ChildProcessSpawner.ChildProcessSpawner,
          makeMockSpawner(() => ({
            stdout: "Authentication required. Please visit the URL to log in:\n",
            exitCode: 1,
          })),
        ),
      );
      const result = yield* probe;
      expect(result.unavailable?.reason).toBe("probeFailed");
      expect(result.unavailable?.message).toContain("expired");
    }).pipe(Effect.scoped, Effect.provide(TestFsLayer)),
  );
});
