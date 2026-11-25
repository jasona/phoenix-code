// @effect-diagnostics nodeBuiltinImport:off
// Windows cleanup must outlive this executable to delete its directory; scoped ChildProcess kills children on exit.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { Command, Flag, GlobalFlag, Prompt } from "effect/cli";

import * as BootService from "../cloud/bootService.ts";
import {
  findPosixLauncher,
  generatedWindowsShimTarget,
  isVersionExecutable,
  pinnedRuntimeVersionsDir,
  readPosixLauncherTarget,
  resolveLauncherPath,
} from "../cloud/pinnedRuntime.ts";
import { projectLocationFlags, resolveCliAuthConfig } from "./config.ts";
import * as CliService from "./service.ts";
import { awaitDetachedSpawn } from "../process/windowsVerbatimSpawn.ts";
import { windowsSystem32Path } from "@t3tools/shared/windowsSystem";
import { findWindowsShim } from "./update.ts";

export class CliUninstallError extends Schema.TaggedError<CliUninstallError>()(
  "CliUninstallError",
  { reason: Schema.String },
) {
  override get message(): string {
    return this.reason;
  }
}

export interface UninstallPlan {
  readonly service: boolean;
  readonly otherHomeService: string | undefined;
  readonly versionsDir: string;
  readonly launchers: ReadonlyArray<string>;
  readonly desktopShims: ReadonlyArray<string>;
  readonly runtimeDir: string | undefined;
  readonly userdataDir: string;
  readonly baseDir: string | undefined;
  readonly completePaths: ReadonlyArray<string>;
}

const DESKTOP_CLI_SHIM_MARKERS = [
  "Written by M3 Code: runs the desktop app's bundled t3 CLI.",
  "Written by T3 Code: runs the desktop app's bundled t3 CLI.",
] as const;

const GNOME_SNAPSHOT_EXTENSION_UUID = "snap-shot@t3.codes";

const APP_DATA_PROFILE_NAMES = [
  "t3code-v2",
  "t3code-dev",
  "t3code",
  "M3 Code",
  "M3 Code (Beta)",
  "M3 Code (Nightly)",
  "M3 Code (Dev)",
  "T3 Code (Alpha)",
  "T3 Code (Dev)",
] as const;

const MAC_APP_BUNDLES = ["M3 Code.app", "M3 Code (Beta).app", "M3 Code (Nightly).app"] as const;

const MAC_CACHE_NAMES = [
  "com.m3code.m3code",
  "com.m3code.m3code.ShipIt",
  "M3 Code",
  "M3 Code (Beta)",
  "M3 Code (Nightly)",
  "M3 Code (Dev)",
  "com.t3tools.t3code",
  "com.t3tools.t3code.ShipIt",
] as const;

const MAC_PREFERENCE_FILES = [
  "com.m3code.m3code.plist",
  "com.m3code.m3code.helper.plist",
  "com.t3tools.t3code.plist",
] as const;

const MAC_SAVED_STATE_DIRS = [
  "com.m3code.m3code.savedState",
  "com.t3tools.t3code.savedState",
] as const;

const MAC_LOG_DIRS = [
  "M3 Code",
  "M3 Code (Beta)",
  "M3 Code (Nightly)",
  "M3 Code (Dev)",
  "t3code-v2",
] as const;

const MAC_BUNDLE_STORAGE_IDS = ["com.m3code.m3code", "com.t3tools.t3code"] as const;

const LINUX_CACHE_NAMES = ["m3code", "M3 Code", "t3code", "t3code-v2"] as const;

const WINDOWS_LOCAL_APP_DATA_NAMES = [
  "M3 Code",
  "m3code-updater",
  "t3code-updater",
  "Programs\\M3 Code",
] as const;

function isSafeCompleteRemovalPath(input: {
  readonly path: Path.Path;
  readonly candidate: string;
  readonly homeDir: string;
  readonly appDataDir: string;
}): boolean {
  const resolved = input.path.resolve(input.candidate);
  const home = input.path.resolve(input.homeDir);
  const appData = input.path.resolve(input.appDataDir);
  if (resolved.length === 0 || resolved === input.path.dirname(resolved)) return false;
  const forbidden = new Set([
    home,
    appData,
    "/Applications",
    input.path.join(home, "Applications"),
    input.path.join(home, "Library"),
    input.path.join(home, "Library", "Application Support"),
    input.path.join(home, "Library", "Caches"),
    input.path.join(home, "Library", "Preferences"),
    input.path.join(home, "Library", "Saved Application State"),
    input.path.join(home, "Library", "Logs"),
    input.path.join(home, "Library", "HTTPStorages"),
    input.path.join(home, "Library", "WebKit"),
    input.path.join(home, "Library", "LaunchAgents"),
    input.path.join(home, ".config"),
    input.path.join(home, ".cache"),
    input.path.join(home, ".local"),
    input.path.join(home, ".local", "share"),
    input.path.join(home, ".local", "share", "applications"),
    input.path.join(home, ".local", "share", "gnome-shell"),
    input.path.join(home, ".local", "share", "gnome-shell", "extensions"),
    input.path.join(home, "AppData"),
    input.path.join(home, "AppData", "Roaming"),
    input.path.join(home, "AppData", "Local"),
    input.path.join(home, "AppData", "Local", "Programs"),
  ]);
  return !forbidden.has(resolved);
}

/** Candidate OS-level desktop app, cache, preference, and state paths removed by `--all`. */
function collectCompleteRemovalCandidates(input: {
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly homeDir: string;
  readonly env: Readonly<Record<string, string | undefined>>;
}): ReadonlyArray<string> {
  const { path, platform, homeDir, env } = input;
  const appDataDir =
    platform === "win32"
      ? env.APPDATA?.trim() || path.join(homeDir, "AppData", "Roaming")
      : platform === "darwin"
        ? path.join(homeDir, "Library", "Application Support")
        : env.XDG_CONFIG_HOME?.trim() || path.join(homeDir, ".config");

  const candidates: Array<string> = APP_DATA_PROFILE_NAMES.map((name) =>
    path.join(appDataDir, name),
  );

  if (platform === "darwin") {
    for (const bundle of MAC_APP_BUNDLES) {
      candidates.push(path.join("/Applications", bundle));
      candidates.push(path.join(homeDir, "Applications", bundle));
    }
    const libraryDir = path.join(homeDir, "Library");
    for (const name of MAC_CACHE_NAMES) {
      candidates.push(path.join(libraryDir, "Caches", name));
    }
    for (const file of MAC_PREFERENCE_FILES) {
      candidates.push(path.join(libraryDir, "Preferences", file));
    }
    for (const dir of MAC_SAVED_STATE_DIRS) {
      candidates.push(path.join(libraryDir, "Saved Application State", dir));
    }
    for (const dir of MAC_LOG_DIRS) {
      candidates.push(path.join(libraryDir, "Logs", dir));
    }
    for (const id of MAC_BUNDLE_STORAGE_IDS) {
      candidates.push(path.join(libraryDir, "HTTPStorages", id));
      candidates.push(path.join(libraryDir, "WebKit", id));
    }
  } else if (platform === "linux") {
    const xdgCacheHome = env.XDG_CACHE_HOME?.trim() || path.join(homeDir, ".cache");
    const xdgDataHome = env.XDG_DATA_HOME?.trim() || path.join(homeDir, ".local", "share");
    for (const name of LINUX_CACHE_NAMES) {
      candidates.push(path.join(xdgCacheHome, name));
    }
    candidates.push(
      path.join(xdgDataHome, "applications", "m3code-url-handler.desktop"),
      path.join(xdgDataHome, "applications", "t3code-url-handler.desktop"),
      path.join(xdgDataHome, "gnome-shell", "extensions", GNOME_SNAPSHOT_EXTENSION_UUID),
    );
  } else if (platform === "win32") {
    const localAppData = env.LOCALAPPDATA?.trim() || path.join(homeDir, "AppData", "Local");
    for (const name of WINDOWS_LOCAL_APP_DATA_NAMES) {
      candidates.push(path.join(localAppData, name));
    }
  }

  const seen = new Set<string>();
  const safe: Array<string> = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    if (!isSafeCompleteRemovalPath({ path, candidate: resolved, homeDir, appDataDir })) continue;
    seen.add(resolved);
    safe.push(resolved);
  }
  return safe;
}

/** Finds desktop-installed CLI symlinks/shims in standard user bin directories. */
const findDesktopShimLaunchers = Effect.fn("cli.uninstall.find_desktop_shims")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const homeDir = yield* HostProcess.HomeDirectory;
  const dirs =
    platform === "darwin"
      ? [
          path.join(homeDir, ".local", "bin"),
          path.join(homeDir, "bin"),
          "/opt/homebrew/bin",
          "/usr/local/bin",
        ]
      : platform === "win32"
        ? [path.join(homeDir, ".local", "bin")]
        : [path.join(homeDir, ".local", "bin"), path.join(homeDir, "bin")];
  const names = platform === "win32" ? ["m3.cmd", "t3.cmd"] : ["m3", "t3"];
  const found: Array<string> = [];
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      const info = yield* fs.stat(candidate).pipe(Effect.option);
      if (Option.isNone(info) || info.value.type !== "File" || Number(info.value.size) > 16_384) {
        continue;
      }
      const contents = yield* fs.readFileString(candidate).pipe(Effect.orElseSucceed(() => ""));
      if (DESKTOP_CLI_SHIM_MARKERS.some((marker) => contents.includes(marker))) {
        found.push(candidate);
      }
    }
  }
  return found;
});

/** Delete only launchers targeting this home's runtime/versions. */
export const findOwnedLauncher = Effect.fn("cli.uninstall.find_launcher")(function* (input: {
  readonly launchedAs: string | undefined;
  readonly versionsDir: string;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  if (input.launchedAs === undefined) return undefined;
  if (platform === "win32") {
    const shimPath = yield* findWindowsShim(input.launchedAs);
    if (shimPath === undefined) return undefined;
    const contents = yield* fs.readFileString(shimPath).pipe(Effect.option);
    const target = Option.isSome(contents) ? generatedWindowsShimTarget(contents.value) : undefined;
    return target !== undefined && isVersionExecutable(path, input.versionsDir, target)
      ? shimPath
      : undefined;
  }
  return yield* findPosixLauncher({ launchedAs: input.launchedAs, versionsDir: input.versionsDir });
});

/** Whether `launcher` is a link, unedited `t3` script, or unedited `t3.cmd` into this home's runtime/versions. */
const ownsLauncher = Effect.fn("cli.uninstall.owns_launcher")(function* (
  launcher: string,
  versionsDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const realVersionsDir = yield* fs
    .realPath(versionsDir)
    .pipe(Effect.orElseSucceed(() => versionsDir));
  const scriptTarget = platform === "win32" ? undefined : yield* readPosixLauncherTarget(launcher);
  // The link or script text keeps a pruned (dangling) target; the real path sees through a
  // symlinked T3 home.
  const targets =
    platform === "win32"
      ? [
          yield* fs.readFileString(launcher).pipe(
            Effect.map(generatedWindowsShimTarget),
            Effect.orElseSucceed(() => undefined),
          ),
        ]
      : [
          yield* fs.readLink(launcher).pipe(
            Effect.map((link) => path.resolve(path.dirname(launcher), link)),
            Effect.orElseSucceed(() => undefined),
          ),
          yield* fs.realPath(launcher).pipe(Effect.orElseSucceed(() => undefined)),
          scriptTarget,
          scriptTarget !== undefined
            ? yield* fs.realPath(scriptTarget).pipe(Effect.orElseSucceed(() => undefined))
            : undefined,
        ];
  return targets.some(
    (target) =>
      target !== undefined &&
      (isVersionExecutable(path, versionsDir, target) ||
        isVersionExecutable(path, realVersionsDir, target)),
  );
});

/**
 * Launchers recorded in `runtime/launchers` by the install scripts and `t3 install` that still
 * point into this home's runtime/versions. npx can run a different version than the installed
 * one, so the launcher this process started from does not always name them.
 */
export const findRecordedLaunchers = Effect.fn("cli.uninstall.find_recorded_launchers")(function* (
  versionsDir: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const recorded = yield* fs
    .readFileString(path.join(path.dirname(versionsDir), "launchers"))
    .pipe(Effect.orElseSucceed(() => ""));
  const owned: Array<string> = [];
  for (const launcher of recorded.split(/\r?\n/).filter(Boolean)) {
    if (yield* ownsLauncher(launcher, versionsDir)) owned.push(launcher);
  }
  return owned;
});

// cmd.exe needs verbatim quoting and literal paths, with delayed expansion disabled. The shell
// starts in System32 and runs ping from there, whatever directory `t3 uninstall` was run in.
export function spawnWindowsRemoval(environment: NodeJS.ProcessEnv, dir: string) {
  const ping = windowsSystem32Path(environment, "ping.exe");
  return NodeChildProcess.spawn(
    environment["ComSpec"] ?? environment["COMSPEC"] ?? windowsSystem32Path(environment, "cmd.exe"),
    [
      "/d",
      "/v:off",
      "/s",
      "/c",
      '""%T3_UNINSTALL_PING%" -n 3 127.0.0.1 >nul & rmdir /s /q "%T3_UNINSTALL_RUNTIME%""',
    ],
    {
      cwd: NodePath.win32.dirname(ping),
      env: { ...process.env, T3_UNINSTALL_PING: ping, T3_UNINSTALL_RUNTIME: dir },
      windowsVerbatimArguments: true,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
}

const planUninstall = Effect.fn("cli.uninstall.plan")(function* (input: {
  readonly baseDir: string;
  readonly complete: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const platform = yield* HostProcess.Platform;
  const homeDir = yield* HostProcess.HomeDirectory;
  const env = yield* HostProcess.Environment;
  const service = yield* BootService.BootService;
  const status = yield* service.status;
  const installedBaseDir =
    status.supported && status.installed ? status.installedBaseDir : undefined;
  const servesThisHome = installedBaseDir !== undefined && status.otherBaseDir === undefined;
  const versionsDir = pinnedRuntimeVersionsDir(path, input.baseDir);
  const runtimeDir = path.dirname(versionsDir);
  const launchedAs = (yield* HostProcess.IsExecutable) ? yield* resolveLauncherPath : undefined;
  const launchedFrom = yield* findOwnedLauncher({ launchedAs, versionsDir });
  const baseDirExists = yield* fs.exists(input.baseDir).pipe(Effect.orElseSucceed(() => false));
  const completePaths: Array<string> = [];
  let desktopShims: ReadonlyArray<string> = [];
  if (input.complete) {
    desktopShims = yield* findDesktopShimLaunchers();
    const candidates = collectCompleteRemovalCandidates({ path, platform, homeDir, env });
    for (const candidate of candidates) {
      if (yield* fs.exists(candidate).pipe(Effect.orElseSucceed(() => false))) {
        completePaths.push(candidate);
      }
    }
  }
  const plan: UninstallPlan = {
    service: servesThisHome,
    otherHomeService: servesThisHome ? undefined : installedBaseDir,
    versionsDir,
    launchers: [
      ...new Set([
        ...(launchedFrom === undefined ? [] : [launchedFrom]),
        ...(yield* findRecordedLaunchers(versionsDir)),
      ]),
    ],
    desktopShims,
    runtimeDir: (yield* fs.exists(runtimeDir).pipe(Effect.orElseSucceed(() => false)))
      ? runtimeDir
      : undefined,
    userdataDir: path.join(input.baseDir, "userdata"),
    baseDir: input.complete && baseDirExists ? input.baseDir : undefined,
    completePaths,
  };
  return plan;
});

export const uninstallCommand = Command.make("uninstall", {
  ...projectLocationFlags,
  all: Flag.Boolean("all").pipe(
    Flag.withAlias("a"),
    Flag.withDescription(
      "Completely remove M3 Code: also delete all user data, databases, settings, caches, preferences, and the desktop app.",
    ),
    Flag.withDefault(false),
  ),
  yes: Flag.Boolean("yes").pipe(
    Flag.withAlias("y"),
    Flag.withDescription(
      "Remove everything without asking. Required from a script, where there is no prompt.",
    ),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Remove M3 Code from this machine: the background service, launchers, and downloaded versions. Pass --all to also remove user data, caches, preferences, and the desktop app.",
  ),
  Command.withHandler((flags) =>
    Effect.gen(function* () {
      const logLevel = yield* GlobalFlag.LogLevel;
      const config = yield* resolveCliAuthConfig(flags, logLevel);
      return yield* runUninstall({
        baseDir: config.baseDir,
        complete: flags.all,
        assumeYes: flags.yes,
      }).pipe(Effect.provide(CliService.layer(config)));
    }),
  ),
);

const logOtherHomeService = (plan: UninstallPlan) =>
  plan.otherHomeService === undefined
    ? Effect.void
    : Console.log(
        `The M3 Code service serves ${plan.otherHomeService}, so it was not removed. Pass \`${BootService.formatBootServiceBaseDirOption(plan.otherHomeService)}\` to remove it.`,
      );

const runUninstall = Effect.fn("cli.uninstall.run")(function* (input: {
  readonly baseDir: string;
  readonly complete: boolean;
  readonly assumeYes: boolean;
}) {
  const fs = yield* FileSystem.FileSystem;
  const platform = yield* HostProcess.Platform;
  const environment = yield* HostProcess.Environment;
  const service = yield* BootService.BootService;
  const plan = yield* planUninstall({ baseDir: input.baseDir, complete: input.complete });

  const hasNothing =
    !plan.service &&
    plan.launchers.length === 0 &&
    plan.desktopShims.length === 0 &&
    plan.runtimeDir === undefined &&
    plan.baseDir === undefined &&
    plan.completePaths.length === 0;

  if (hasNothing) {
    yield* Console.log(`Nothing to remove: M3 Code is not installed for ${input.baseDir}.`);
    if (!(yield* HostProcess.IsExecutable)) {
      yield* Console.log(
        "  This CLI runs from a Node script, so it was installed by npm or built from source. Remove it the same way (`npm uninstall -g t3`, or delete the checkout).",
      );
    }
    yield* logOtherHomeService(plan);
    return;
  }

  yield* Console.log("This will remove:");
  if (plan.service) yield* Console.log("  the background service (stopping it first)");
  for (const launcher of plan.launchers) yield* Console.log(`  the launcher at ${launcher}`);
  for (const shim of plan.desktopShims) yield* Console.log(`  the desktop CLI launcher at ${shim}`);
  if (plan.baseDir !== undefined) {
    yield* Console.log(`  all M3 Code data, settings, and versions under ${plan.baseDir}`);
  } else if (plan.runtimeDir !== undefined) {
    yield* Console.log(`  every downloaded version under ${plan.runtimeDir}`);
  }
  for (const target of plan.completePaths) {
    yield* Console.log(`  ${target}`);
  }
  if (!input.complete) {
    yield* Console.log(
      `Your projects, threads, and settings under ${plan.userdataDir} are kept. Pass --all to remove M3 Code completely, including user data, caches, preferences, and the desktop app.`,
    );
  }

  if (!input.assumeYes) {
    if (!(process.stdin.isTTY && process.stdout.isTTY)) {
      return yield* new CliUninstallError({
        reason:
          "Not a terminal, so nothing was removed. Rerun with --yes to confirm from a script.",
      });
    }
    const confirmed = yield* Prompt.run(
      Prompt.Confirm({
        message: input.complete
          ? "Permanently remove M3 Code and ALL its data from this machine?"
          : "Remove M3 Code from this machine?",
        initial: false,
      }),
    ).pipe(Effect.catchTags({ QuitError: () => Effect.succeed(false) }));
    if (!confirmed) {
      yield* Console.log("Left as is.");
      return;
    }
  }

  // The prompt can wait a long time; keep a service or launcher that changed hands meanwhile.
  if (plan.service && (yield* service.status).otherBaseDir !== undefined) {
    yield* Console.log("Left the background service: it now serves another T3 home.");
  } else if (plan.service) {
    yield* service.uninstall;
    yield* Console.log("Removed the background service.");
  }
  for (const launcher of plan.launchers) {
    if (!(yield* ownsLauncher(launcher, plan.versionsDir))) {
      yield* Console.log(`Left ${launcher}: it no longer runs this installation.`);
      continue;
    }
    yield* fs
      .remove(launcher, { force: true })
      .pipe(
        Effect.mapError(
          () => new CliUninstallError({ reason: `Could not remove the launcher at ${launcher}.` }),
        ),
      );
    yield* Console.log(`Removed ${launcher}.`);
  }
  for (const shim of plan.desktopShims) {
    yield* fs.remove(shim, { force: true }).pipe(
      Effect.mapError(
        () =>
          new CliUninstallError({
            reason: `Could not remove the desktop CLI launcher at ${shim}.`,
          }),
      ),
    );
    yield* Console.log(`Removed ${shim}.`);
  }
  for (const target of plan.completePaths) {
    yield* fs
      .remove(target, { recursive: true, force: true })
      .pipe(
        Effect.mapError(() => new CliUninstallError({ reason: `Could not remove ${target}.` })),
      );
    yield* Console.log(`Removed ${target}.`);
  }
  const dirToRemove = plan.baseDir ?? plan.runtimeDir;
  if (dirToRemove !== undefined) {
    // Windows refuses to unlink this running executable; a detached shell removes it after exit.
    if (platform === "win32") {
      const notScheduled = () =>
        new CliUninstallError({
          reason: `Could not schedule removal of ${dirToRemove}. Delete it yourself once this window is closed.`,
        });
      yield* awaitDetachedSpawn(() => spawnWindowsRemoval(environment, dirToRemove)).pipe(
        Effect.mapError(notScheduled),
      );
      yield* Console.log(`${dirToRemove} will be removed once the CLI exits.`);
    } else {
      yield* fs
        .remove(dirToRemove, { recursive: true, force: true })
        .pipe(
          Effect.mapError(
            () => new CliUninstallError({ reason: `Could not remove ${dirToRemove}.` }),
          ),
        );
      yield* Console.log(`Removed ${dirToRemove}.`);
    }
  }
  yield* Console.log("");
  yield* Console.log(
    input.complete
      ? "M3 Code has been completely uninstalled."
      : "M3 Code is uninstalled. Thanks for trying M3 Code.",
  );
  yield* logOtherHomeService(plan);
});
