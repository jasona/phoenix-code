import {
  OrchestrationV2GetSwarmBoardError,
  OrchestrationV2GetSwarmMemberTranscriptError,
  type OrchestrationV2GetSwarmBoardInput,
  type OrchestrationV2GetSwarmBoardResult,
  type OrchestrationV2GetSwarmMemberTranscriptInput,
  type OrchestrationV2GetSwarmMemberTranscriptResult,
  type ProviderInstanceId,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

import * as ServerConfig from "../config.ts";
import {
  readAntigravitySwarmBoard,
  readAntigravitySwarmMemberTranscript,
} from "../provider/acp/AntigravitySwarm.ts";
import { resolveAntigravityInstanceDirectories } from "../provider/antigravityAuthSupport.ts";
import * as ThreadManagement from "./ThreadManagementService.ts";

/** Reads a thread's provider-native swarm board and worker transcripts, on demand. */
export class SwarmBoardQuery extends Context.Service<
  SwarmBoardQuery,
  {
    readonly getSwarmBoard: (
      input: OrchestrationV2GetSwarmBoardInput,
    ) => Effect.Effect<OrchestrationV2GetSwarmBoardResult, OrchestrationV2GetSwarmBoardError>;
    readonly getSwarmMemberTranscript: (
      input: OrchestrationV2GetSwarmMemberTranscriptInput,
    ) => Effect.Effect<
      OrchestrationV2GetSwarmMemberTranscriptResult,
      OrchestrationV2GetSwarmMemberTranscriptError
    >;
  }
>()("t3/orchestration-v2/SwarmBoardQuery") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const { stateDir } = yield* ServerConfig.ServerConfig;
  const digest = yield* Digest.Digest;
  const path = yield* Path.Path;

  const resolveAntigravitySession = Effect.fn("SwarmBoardQuery.resolveAntigravitySession")(
    function* (threadId: ThreadId) {
      const { thread, providerThreads, runs } = yield* threads.getThreadRecords(threadId, [
        "providerThreads",
        "runs",
      ]);
      if (thread.deletedAt !== null) return null;

      // Prefer the active or latest run's Antigravity provider thread, falling back to any Antigravity provider thread on the thread.
      const sortedRuns = [...runs].sort((left, right) => right.ordinal - left.ordinal);
      let candidateProviderThread = sortedRuns
        .map((run) => providerThreads.find((candidate) => candidate.id === run.providerThreadId))
        .find((candidate) => candidate?.driver === "antigravity");
      if (!candidateProviderThread) {
        candidateProviderThread = providerThreads.find(
          (candidate) => candidate.driver === "antigravity",
        );
      }
      if (!candidateProviderThread) return null;

      const latestMatchingRun = sortedRuns.find(
        (run) => run.providerThreadId === candidateProviderThread.id,
      );
      let rootSessionId = candidateProviderThread.nativeThreadRef?.nativeId ?? null;
      if (latestMatchingRun?.activeAttemptId) {
        const { attempts } = yield* threads.getThreadRecords(threadId, ["attempts"], {
          attemptIds: [latestMatchingRun.activeAttemptId],
        });
        const attemptNativeId = attempts[0]?.nativeThreadId;
        if (attemptNativeId) rootSessionId = attemptNativeId;
      }
      if (!rootSessionId) return null;

      const directories = yield* resolveAntigravityInstanceDirectories(
        stateDir,
        candidateProviderThread.providerInstanceId as ProviderInstanceId,
      ).pipe(Effect.provideService(Digest.Digest, digest), Effect.provideService(Path.Path, path));

      return {
        profileDirectory: directories.profile,
        rootSessionId,
      };
    },
  );

  const getSwarmBoard = Effect.fn("SwarmBoardQuery.getSwarmBoard")(
    function* (input: OrchestrationV2GetSwarmBoardInput) {
      const session = yield* resolveAntigravitySession(input.threadId);
      if (!session) return { swarm: null } satisfies OrchestrationV2GetSwarmBoardResult;
      return yield* readAntigravitySwarmBoard({
        profileDirectory: session.profileDirectory,
        rootSessionId: session.rootSessionId,
        ...(input.etag !== undefined ? { etag: input.etag } : {}),
        ...(input.tail !== undefined ? { tail: input.tail } : {}),
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) => new OrchestrationV2GetSwarmBoardError({ threadId: input.threadId, cause }),
        ),
      ),
  );

  const getSwarmMemberTranscript = Effect.fn("SwarmBoardQuery.getSwarmMemberTranscript")(
    function* (input: OrchestrationV2GetSwarmMemberTranscriptInput) {
      const session = yield* resolveAntigravitySession(input.threadId);
      if (!session) {
        return {
          memberName: input.memberName,
          conversationId: "",
          steps: null,
          truncated: false,
        } satisfies OrchestrationV2GetSwarmMemberTranscriptResult;
      }
      return yield* readAntigravitySwarmMemberTranscript({
        profileDirectory: session.profileDirectory,
        rootSessionId: session.rootSessionId,
        memberName: input.memberName,
      });
    },
    (effect, input) =>
      effect.pipe(
        Effect.mapError(
          (cause) =>
            new OrchestrationV2GetSwarmMemberTranscriptError({
              threadId: input.threadId,
              memberName: input.memberName,
              cause,
            }),
        ),
      ),
  );

  return SwarmBoardQuery.of({ getSwarmBoard, getSwarmMemberTranscript });
});

export const layer = Layer.effect(SwarmBoardQuery, make);
