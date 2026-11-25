// @effect-diagnostics-next-line nodeBuiltinImport:off - Effect's symlink has no type argument, and Windows needs a junction to link without elevation.
import * as NodeFSP from "node:fs/promises";

import type { AntigravitySettings, ServerProviderUsageWindow } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { collectUint8StreamText } from "@t3tools/provider-core/server/collectStreamText";
import {
  makeUnavailableUsageLimits,
  makeUsageLimits,
} from "@t3tools/provider-core/server/usageLimits";

const SUMMARY_WINDOW_MINS = new Map([
  ["5h", 5 * 60],
  ["weekly", 7 * 24 * 60],
]);

const MAX_USAGE_STDOUT_BYTES = 256 * 1024;
const MAX_USAGE_STDERR_BYTES = 32 * 1024;
const CLI_PRINT_TIMEOUT = "15s";
const PROBE_TIMEOUT = "25 seconds";

const STRIPPED_ENV_KEYS = new Set([
  "DISPLAY",
  "WAYLAND_DISPLAY",
  "BROWSER",
  "GEMINI_HOME",
  "AGY_ACP_FORCE_FILE_STORAGE",
  "AGY_CLI_DISABLE_AUTO_UPDATE",
  "ELECTRON_RUN_AS_NODE",
  "CHROME_CRASHPAD_PIPE_NAME",
]);

const CliUsageBucket = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  window: Schema.optional(Schema.String),
  remaining_fraction: Schema.optional(Schema.Number),
  reset_time: Schema.optional(Schema.String),
  disabled: Schema.optional(Schema.Boolean),
});

const CliUsageGroup = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  buckets: Schema.optional(Schema.Array(CliUsageBucket)),
});

const CliUsageOutput = Schema.Struct({
  status: Schema.optional(Schema.String),
  command: Schema.optional(
    Schema.Struct({
      name: Schema.optional(Schema.String),
      data: Schema.optional(
        Schema.Struct({
          groups: Schema.optional(Schema.Array(CliUsageGroup)),
          buckets: Schema.optional(Schema.Array(CliUsageBucket)),
        }),
      ),
    }),
  ),
});

const decodeCliUsageJson = Schema.decodeEffect(Schema.fromJsonString(CliUsageOutput));

class AntigravityUsageProbeError extends Schema.TaggedError<AntigravityUsageProbeError>()(
  "AntigravityUsageProbeError",
  { cause: Schema.Defect() },
) {
  override get message(): string {
    return "Could not prepare the Antigravity usage probe environment.";
  }
}

function parseResetTime(
  bucket: typeof CliUsageBucket.Type,
  windowDurationMins: number | undefined,
  requestedAt: number,
): string | undefined {
  if (!bucket.reset_time) return undefined;
  const parsed = DateTime.make(bucket.reset_time);
  if (Option.isNone(parsed)) return undefined;
  const epochMillis = DateTime.toEpochMillis(parsed.value);
  // Untouched buckets can report Unix epoch (1970-01-01T00:00:00Z).
  if (epochMillis <= 0) return undefined;
  // Untouched summary buckets can also report a rolling full-window reset.
  const untouched =
    bucket.remaining_fraction === 1 &&
    bucket.description === undefined &&
    windowDurationMins !== undefined &&
    Math.abs(epochMillis - requestedAt - windowDurationMins * 60_000) <= 60_000;
  return untouched ? undefined : DateTime.formatIso(parsed.value);
}

function cliUsageWindows(
  output: typeof CliUsageOutput.Type,
  requestedAt: number,
): ReadonlyArray<ServerProviderUsageWindow> {
  if (output.status !== undefined && output.status !== "SUCCESS") {
    return [];
  }
  const data = output.command?.data;
  if (!data) return [];
  const groups = data.groups?.some((group) => group.buckets?.length)
    ? data.groups
    : [{ buckets: data.buckets }];
  const windows = new Map<string, ServerProviderUsageWindow>();
  for (const group of groups ?? []) {
    for (const bucket of group.buckets ?? []) {
      if (bucket.disabled) continue;
      if (bucket.remaining_fraction === undefined || !Number.isFinite(bucket.remaining_fraction)) {
        continue;
      }
      // Argon and Carbon are metered separately from the default Gemini buckets.
      const family = bucket.id.startsWith("gemini-argon-")
        ? group.name?.trim() || "Gemini Argon"
        : bucket.id.startsWith("gemini-carbon-")
          ? group.name?.trim() || "Gemini Carbon"
          : bucket.id.startsWith("gemini-")
            ? "Gemini"
            : bucket.id.startsWith("3p-")
              ? "Claude & GPT (shared)"
              : group.name?.trim() || bucket.id;
      const weekly = bucket.window === "weekly";
      const session = bucket.window === "5h";
      const windowDurationMins = SUMMARY_WINDOW_MINS.get(bucket.window ?? "");
      const resetsAt = parseResetTime(bucket, windowDurationMins, requestedAt);
      windows.set(bucket.id, {
        id: bucket.id,
        label: `${family} · ${weekly ? "Weekly" : session ? "5-hour" : bucket.name?.trim() || "Quota"}`,
        kind: weekly ? "weekly" : session ? "session" : "other",
        usedPercent: (1 - Math.max(0, Math.min(1, bucket.remaining_fraction))) * 100,
        ...(resetsAt ? { resetsAt } : {}),
        ...(windowDurationMins === undefined ? {} : { windowDurationMins }),
      });
    }
  }
  return [...windows.values()];
}

function extractJsonPayload(stdout: string): string {
  const trimmed = stdout.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const lines = trimmed.split(/\r?\n/);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]?.trim();
    if (line && line.startsWith("{")) return line;
  }
  return trimmed;
}

/** Parse structured JSON emitted by `agy --print /usage --output-format json`. */
export const parseAntigravityCliUsageOutput = (stdout: string, requestedAt: number) =>
  decodeCliUsageJson(extractJsonPayload(stdout)).pipe(
    Effect.map((output) => cliUsageWindows(output, requestedAt)),
  );

function buildCliUsageEnvironment(input: {
  readonly baseEnv: NodeJS.ProcessEnv;
  readonly homeDir: string;
  readonly platform: NodeJS.Platform;
  readonly authMethod: AntigravitySettings["authMethod"];
}): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(input.baseEnv)) {
    if (!STRIPPED_ENV_KEYS.has(key.toUpperCase())) environment[key] = value;
  }
  return {
    ...environment,
    HOME: input.homeDir,
    ...(input.platform === "win32" ? { USERPROFILE: input.homeDir } : {}),
    ...(input.authMethod === "oauth-personal"
      ? { SSH_CONNECTION: input.baseEnv.SSH_CONNECTION || "127.0.0.1 0 127.0.0.1 0" }
      : {}),
    AGY_CLI_DISABLE_AUTO_UPDATE: "1",
  };
}

/**
 * Reads Antigravity subscription usage limits through the official `agy` CLI
 * (`agy --print /usage --output-format json`), without extracting OAuth tokens,
 * touching the OS keyring, or calling undocumented internal Google APIs.
 */
export const makeAntigravityUsageProbe = Effect.fn("makeAntigravityUsageProbe")(function* (input: {
  readonly profileDirectory: string;
  readonly authMethod: AntigravitySettings["authMethod"];
  readonly resolveExecutable?: Effect.Effect<string | undefined, unknown>;
  readonly baseEnv?: NodeJS.ProcessEnv;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const platform = yield* HostProcess.Platform;
  const acpDirectory = path.join(input.profileDirectory, "antigravity-acp");

  const read = Effect.gen(function* () {
    const checkedAt = DateTime.formatIso(yield* DateTime.now);
    if (input.authMethod !== "oauth-personal" && input.authMethod !== "oauth-business") {
      return makeUnavailableUsageLimits({ checkedAt, reason: "unsupported" });
    }
    if (!(yield* fs.exists(acpDirectory))) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "unsupported",
        message: "Sign in with Google to see Antigravity limits.",
      });
    }
    if (input.authMethod === "oauth-personal") {
      const hasSavedToken =
        (yield* fs.exists(path.join(acpDirectory, "antigravity-oauth-token"))) ||
        (yield* fs.exists(path.join(acpDirectory, "acp_token.json")));
      if (!hasSavedToken) {
        return makeUnavailableUsageLimits({
          checkedAt,
          reason: "unsupported",
          message: "Sign in with Google to see Antigravity limits.",
        });
      }
    }
    const executablePath = input.resolveExecutable
      ? yield* input.resolveExecutable.pipe(Effect.orElseSucceed(() => undefined))
      : undefined;
    if (!executablePath) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Antigravity CLI executable could not be resolved.",
      });
    }

    const requestedAt = yield* Clock.currentTimeMillis;
    const { stdout, stderr, exitCode } = yield* Effect.scoped(
      Effect.gen(function* () {
        const homeDir = yield* fs.makeTempDirectoryScoped({ prefix: "t3-antigravity-usage-" });
        const geminiDir = path.join(homeDir, ".gemini");
        yield* fs.makeDirectory(geminiDir, { recursive: true, mode: 0o700 });
        yield* Effect.tryPromise({
          try: () =>
            NodeFSP.symlink(
              acpDirectory,
              path.join(geminiDir, "antigravity-cli"),
              platform === "win32" ? "junction" : "dir",
            ),
          catch: (cause) => new AntigravityUsageProbeError({ cause }),
        });
        const child = yield* spawner.spawn(
          ChildProcess.make(
            executablePath,
            ["--print", "/usage", "--output-format", "json", "--print-timeout", CLI_PRINT_TIMEOUT],
            {
              cwd: homeDir,
              env: buildCliUsageEnvironment({
                baseEnv: input.baseEnv ?? process.env,
                homeDir,
                platform,
                authMethod: input.authMethod,
              }),
              extendEnv: false,
              shell: false,
            },
          ),
        );
        // Close stdin immediately so an unauthenticated CLI never blocks waiting for an auth code.
        yield* Stream.empty.pipe(Stream.run(child.stdin), Effect.ignore, Effect.forkScoped);
        const [out, err, code] = yield* Effect.all(
          [
            collectUint8StreamText({ stream: child.stdout, maxBytes: MAX_USAGE_STDOUT_BYTES }),
            collectUint8StreamText({ stream: child.stderr, maxBytes: MAX_USAGE_STDERR_BYTES }),
            child.exitCode,
          ],
          { concurrency: "unbounded" },
        );
        return { stdout: out.text, stderr: err.text, exitCode: Number(code) };
      }),
    ).pipe(Effect.timeout(PROBE_TIMEOUT));

    const combinedOutput = `${stdout}\n${stderr}`;
    if (/authentication required/i.test(combinedOutput)) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message:
          "Antigravity's saved sign-in has expired. Start an Antigravity turn to renew it, then refresh limits.",
      });
    }
    if (exitCode !== 0) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Could not read Antigravity usage limits from the agy CLI.",
      });
    }

    const windows = yield* parseAntigravityCliUsageOutput(stdout, requestedAt);
    if (windows.length === 0) {
      return makeUnavailableUsageLimits({
        checkedAt,
        reason: "probeFailed",
        message: "Antigravity CLI did not return any usage limit windows.",
      });
    }
    return makeUsageLimits({ checkedAt, windows });
  });

  const probe = read.pipe(
    Effect.catch(() =>
      DateTime.now.pipe(
        Effect.map((now) =>
          makeUnavailableUsageLimits({
            checkedAt: DateTime.formatIso(now),
            reason: "probeFailed",
            message: "Could not read Antigravity usage limits from the agy CLI.",
          }),
        ),
      ),
    ),
  );

  return {
    probe,
    clear: Effect.void,
  };
});
