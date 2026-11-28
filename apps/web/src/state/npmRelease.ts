import { type ServerConfig, ServerNpmReleaseError } from "@t3tools/contracts";
import {
  CLI_RELEASE_REPOSITORY,
  cliReleaseIndexPageUrl,
  newestCliReleaseVersion,
} from "@t3tools/shared/cliRelease";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import { msg } from "gt-react";

import { m, type MessageResolver } from "../i18n/messages";

import { environmentSummaries } from "./presentation";
import { primaryEnvironmentIdAtom } from "./primaryEnvironment";
import { serverEnvironment } from "./server";

const isServerNpmReleaseError = Schema.is(ServerNpmReleaseError);

function unsupportedLookup(config: ServerConfig | null): ServerNpmReleaseError | null {
  if (config === null) {
    return new ServerNpmReleaseError({
      reason: m(msg("Connect to this server to check releases.")),
    });
  }
  return config.environment.capabilities.npmReleaseLookup === true
    ? null
    : new ServerNpmReleaseError({
        reason: m(
          msg("This server does not support registry lookups. Update it before switching tracks."),
        ),
      });
}

class PhoenixReleaseLookupError extends Schema.TaggedError<PhoenixReleaseLookupError>()(
  "PhoenixReleaseLookupError",
  {},
) {}

const isPhoenixReleaseLookupError = Schema.is(PhoenixReleaseLookupError);

export function npmReleaseFailureMessage(
  cause: Cause.Cause<unknown>,
  resolve: MessageResolver = m,
): string {
  const error = Option.getOrUndefined(Cause.findErrorOption(cause));
  return isServerNpmReleaseError(error)
    ? error.message
    : isPhoenixReleaseLookupError(error)
      ? resolve(msg("Could not check for updates"))
      : resolve(
          msg(
            "Could not check this environment's npm registry. Check the connection and registry settings.",
          ),
        );
}

const PhoenixRelease = Schema.Struct({
  tag_name: Schema.String,
  draft: Schema.Boolean,
  body: Schema.NullOr(Schema.String),
});

const decodePhoenixReleases = Schema.decodeUnknownSync(Schema.Array(PhoenixRelease));

export async function lookupPhoenixTrack(channel: "latest" | "nightly", signal: AbortSignal) {
  const request = async (url: string) => {
    const response = await fetch(url, { signal });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
    return response.json() as Promise<unknown>;
  };
  // Stable has a permanent endpoint. GitHub's "latest" excludes prereleases.
  for (let page = 1; ; page++) {
    const json = await request(
      channel === "latest"
        ? `https://api.github.com/repos/${CLI_RELEASE_REPOSITORY}/releases/latest`
        : cliReleaseIndexPageUrl(page),
    );
    if (json === null) return null;
    const releases = decodePhoenixReleases(channel === "latest" ? [json] : json);
    const version = newestCliReleaseVersion(releases, channel === "latest" ? "stable" : "nightly");
    const release = releases.find((entry) => !entry.draft && entry.tag_name === `v${version}`);
    if (version && release) {
      const migration = /^Database migration: (\d+)$/m.exec(release.body ?? "")?.[1];
      return {
        version,
        databaseMigration: migration === undefined ? undefined : Number(migration),
      };
    }
    if (channel === "latest" || releases.length < 100) return null;
  }
}

export const npmReleaseAtom = Atom.family((spec: string) =>
  Atom.make((get) => {
    if (
      import.meta.env.T3CODE_DESKTOP_UPDATE_REPOSITORY === CLI_RELEASE_REPOSITORY &&
      (spec === "latest" || spec === "nightly")
    ) {
      return Effect.tryPromise({
        try: (signal) =>
          lookupPhoenixTrack(spec, AbortSignal.any([signal, AbortSignal.timeout(15000)])),
        catch: () => new PhoenixReleaseLookupError(),
      }).pipe(
        Effect.filterOrFail(
          (release) => release !== null,
          () => new PhoenixReleaseLookupError(),
        ),
      );
    }
    const primary = get(primaryEnvironmentIdAtom);
    // With the desktop's local server turned off there is no primary, so a connected server answers.
    const candidates =
      primary === null ? get(environmentSummaries.connectedEnvironmentIdsAtom) : [primary];
    const environmentId =
      candidates.find(
        (id) => unsupportedLookup(get(serverEnvironment.configValueAtom(id))) === null,
      ) ?? candidates[0];
    if (environmentId === undefined) {
      return Effect.fail(
        new ServerNpmReleaseError({ reason: m(msg("Connect to a server to check releases.")) }),
      );
    }
    const unsupported = unsupportedLookup(get(serverEnvironment.configValueAtom(environmentId)));
    if (unsupported !== null) return Effect.fail(unsupported);
    return get
      .result(serverEnvironment.npmRelease({ environmentId, input: { spec } }))
      .pipe(
        Effect.map((release) =>
          release === null
            ? null
            : { version: release.version, databaseMigration: release.databaseMigration },
        ),
      );
  }).pipe(Atom.withLabel(`npm-release:${spec}`)),
);
