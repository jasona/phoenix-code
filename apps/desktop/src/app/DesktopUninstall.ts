// @effect-diagnostics nodeBuiltinImport:off
// Detached cleanup must outlive the Electron process so it can remove userData, baseDir, and the app bundle after exit.
import * as NodeChildProcess from "node:child_process";

import type { DesktopUninstallPlan } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import * as DesktopBackendManager from "../backend/DesktopBackendManager.ts";
import * as DesktopBackendPool from "../backend/DesktopBackendPool.ts";
import * as ElectronApp from "../electron/ElectronApp.ts";
import { GNOME_CAPTURE_UUID } from "../snapShot/gnomeCaptureBundle.ts";
import * as DesktopAppIdentity from "./DesktopAppIdentity.ts";
import * as DesktopCliCommand from "./DesktopCliCommand.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";
import * as DesktopShutdown from "./DesktopShutdown.ts";

const { logInfo, logWarning } = makeComponentLogger("desktop-uninstall");

export class DesktopUninstallError extends Schema.TaggedError<DesktopUninstallError>()(
  "DesktopUninstallError",
  { message: Schema.String },
) {}

export class DesktopUninstall extends Context.Service<
  DesktopUninstall,
  {
    readonly getPlan: Effect.Effect<DesktopUninstallPlan, DesktopUninstallError>;
    readonly run: Effect.Effect<void, DesktopUninstallError>;
  }
>()("@t3tools/desktop/app/DesktopUninstall") {}

const MAC_LAUNCH_AGENT_LABELS = [
  "com.m3code.m3code.service",
  "com.t3tools.t3code.service",
] as const;

const LINUX_SYSTEMD_UNITS = ["m3code.service", "t3code.service"] as const;

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

/** Walks up from a macOS executable path to find its enclosing `.app` bundle directory. */
export function resolveMacAppBundlePath(path: Path.Path, execPath: string): string | null {
  let current = path.resolve(execPath);
  for (;;) {
    if (current.endsWith(".app") && path.basename(current) !== ".app") {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Guards against ever scheduling deletion of a root, home, or shared OS container directory.
 */
export function isSafeRemovalPath(input: {
  readonly path: Path.Path;
  readonly candidate: string;
  readonly homeDirectory: string;
  readonly appDataDirectory: string;
}): boolean {
  const resolved = input.path.resolve(input.candidate);
  const home = input.path.resolve(input.homeDirectory);
  const appData = input.path.resolve(input.appDataDirectory);
  if (resolved.length === 0 || resolved === input.path.dirname(resolved)) {
    return false;
  }
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

export interface DesktopUninstallCandidateSet {
  readonly appBundlePath: string | null;
  readonly serviceUnitPaths: ReadonlyArray<string>;
  readonly paths: ReadonlyArray<string>;
}

/**
 * Computes all candidate filesystem paths belonging to M3 Code on the current OS.
 * Only paths that exist on disk are included in the final plan and cleanup invocation.
 */
export function collectDesktopUninstallCandidates(input: {
  readonly path: Path.Path;
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly executablePath: string;
  readonly homeDirectory: string;
  readonly appDataDirectory: string;
  readonly baseDir: string;
  readonly userDataPath: string;
  readonly linuxApplicationsDir: string;
  readonly linuxDesktopEntryName: string;
  readonly appImagePath: Option.Option<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
}): DesktopUninstallCandidateSet {
  const { path, platform, homeDirectory, appDataDirectory } = input;
  const candidates: Array<string> = [
    input.baseDir,
    input.userDataPath,
    ...APP_DATA_PROFILE_NAMES.map((name) => path.join(appDataDirectory, name)),
  ];
  const serviceUnitPaths: Array<string> = [];
  let appBundlePath: string | null = null;

  if (platform === "darwin") {
    const libraryDir = path.join(homeDirectory, "Library");
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
    for (const label of MAC_LAUNCH_AGENT_LABELS) {
      const plistPath = path.join(libraryDir, "LaunchAgents", `${label}.plist`);
      serviceUnitPaths.push(plistPath);
      candidates.push(plistPath);
    }
    if (input.isPackaged) {
      const bundle = resolveMacAppBundlePath(path, input.executablePath);
      if (bundle !== null) {
        appBundlePath = bundle;
        candidates.push(bundle);
      }
    }
  } else if (platform === "linux") {
    const xdgCacheHome = input.env.XDG_CACHE_HOME?.trim() || path.join(homeDirectory, ".cache");
    const xdgDataHome =
      input.env.XDG_DATA_HOME?.trim() || path.join(homeDirectory, ".local", "share");
    const xdgConfigHome = input.env.XDG_CONFIG_HOME?.trim() || path.join(homeDirectory, ".config");
    for (const name of LINUX_CACHE_NAMES) {
      candidates.push(path.join(xdgCacheHome, name));
    }
    candidates.push(
      path.join(input.linuxApplicationsDir, input.linuxDesktopEntryName),
      path.join(input.linuxApplicationsDir, "m3code-url-handler.desktop"),
      path.join(input.linuxApplicationsDir, "t3code-url-handler.desktop"),
      path.join(xdgDataHome, "gnome-shell", "extensions", GNOME_CAPTURE_UUID),
    );
    for (const unit of LINUX_SYSTEMD_UNITS) {
      const unitPath = path.join(xdgConfigHome, "systemd", "user", unit);
      serviceUnitPaths.push(unitPath);
      candidates.push(unitPath);
    }
    if (input.isPackaged && Option.isSome(input.appImagePath)) {
      appBundlePath = path.resolve(input.appImagePath.value);
      candidates.push(appBundlePath);
    }
  } else if (platform === "win32") {
    const localAppData =
      input.env.LOCALAPPDATA?.trim() || path.join(homeDirectory, "AppData", "Local");
    for (const name of WINDOWS_LOCAL_APP_DATA_NAMES) {
      candidates.push(path.join(localAppData, name));
    }
    if (input.isPackaged) {
      const installDir = path.dirname(path.resolve(input.executablePath));
      const base = path.basename(installDir).toLowerCase();
      if (base.includes("m3 code") || base.includes("m3code") || base.includes("t3 code")) {
        appBundlePath = installDir;
        candidates.push(installDir);
      }
    }
  }

  const seen = new Set<string>();
  const safePaths: Array<string> = [];
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (seen.has(resolved)) continue;
    if (
      !isSafeRemovalPath({
        path,
        candidate: resolved,
        homeDirectory,
        appDataDirectory,
      })
    ) {
      continue;
    }
    seen.add(resolved);
    safePaths.push(resolved);
  }

  const safeBundlePath =
    appBundlePath !== null && seen.has(path.resolve(appBundlePath))
      ? path.resolve(appBundlePath)
      : null;

  return {
    appBundlePath: safeBundlePath,
    serviceUnitPaths,
    paths: safePaths,
  };
}

const POSIX_CLEANUP_SCRIPT = [
  'pid="$1"',
  "shift",
  "i=0",
  'while [ "$i" -lt 150 ] && kill -0 "$pid" 2>/dev/null; do',
  "  sleep 0.1",
  "  i=$((i + 1))",
  "done",
  'for target in "$@"; do',
  '  [ -n "$target" ] && rm -rf -- "$target" 2>/dev/null || true',
  "done",
].join("\n");

/**
 * Spawns a detached OS helper that waits for the Electron app PID to exit and then
 * deletes all scheduled M3 Code paths.
 */
function spawnDetachedDesktopCleanup(input: {
  readonly platform: NodeJS.Platform;
  readonly pid: number;
  readonly paths: ReadonlyArray<string>;
  readonly env: Readonly<Record<string, string | undefined>>;
}): Effect.Effect<void, DesktopUninstallError> {
  if (input.paths.length === 0) return Effect.void;
  return Effect.callback<void, DesktopUninstallError>((resume) => {
    const child =
      input.platform === "win32"
        ? (() => {
            const comspec = input.env.ComSpec ?? input.env.COMSPEC ?? "cmd.exe";
            const envVars: Record<string, string> = {};
            const deleteSteps: Array<string> = [];
            for (const [index, target] of input.paths.entries()) {
              const key = `M3_UNINSTALL_TARGET_${index}`;
              envVars[key] = target;
              deleteSteps.push(
                `if exist "%${key}%" (rmdir /s /q "%${key}%" 2>nul || del /f /q "%${key}%" 2>nul)`,
              );
            }
            const command = `"ping -n 4 127.0.0.1 >nul & ${deleteSteps.join(" & ")}"`;
            return NodeChildProcess.spawn(comspec, ["/d", "/v:off", "/s", "/c", command], {
              env: { ...process.env, ...envVars },
              windowsVerbatimArguments: true,
              detached: true,
              stdio: "ignore",
              windowsHide: true,
            });
          })()
        : NodeChildProcess.spawn(
            "/bin/sh",
            ["-c", POSIX_CLEANUP_SCRIPT, "m3-desktop-uninstall", String(input.pid), ...input.paths],
            {
              detached: true,
              stdio: "ignore",
            },
          );

    let settled = false;
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      resume(
        Effect.fail(
          new DesktopUninstallError({
            message: `Could not start the uninstall cleanup helper: ${error.message}`,
          }),
        ),
      );
    });
    child.once("spawn", () => {
      if (settled) return;
      settled = true;
      child.unref();
      resume(Effect.void);
    });
  });
}

const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
  const cliCommand = yield* DesktopCliCommand.DesktopCliCommand;
  const backendPool = yield* DesktopBackendPool.DesktopBackendPool;
  const shutdown = yield* DesktopShutdown.DesktopShutdown;
  const electronApp = yield* ElectronApp.ElectronApp;
  const fs = yield* FileSystem.FileSystem;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const env = yield* HostProcess.Environment;
  const executablePath = yield* HostProcess.ExecutablePath;

  const exists = (target: string) => fs.exists(target).pipe(Effect.orElseSucceed(() => false));

  const runIgnore = (command: string, args: ReadonlyArray<string>) =>
    Effect.scoped(
      spawner
        .spawn(
          ChildProcess.make(command, [...args], {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            forceKillAfter: "2 seconds",
          }),
        )
        .pipe(Effect.flatMap((handle) => handle.exitCode.pipe(Effect.timeout("5 seconds")))),
    ).pipe(Effect.ignore);

  const stopBackgroundServices = Effect.gen(function* () {
    if (environment.platform === "darwin") {
      const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
      for (const label of MAC_LAUNCH_AGENT_LABELS) {
        const plistPath = environment.path.join(
          environment.homeDirectory,
          "Library",
          "LaunchAgents",
          `${label}.plist`,
        );
        if (uid !== undefined) {
          yield* runIgnore("launchctl", ["bootout", `gui/${uid}/${label}`]);
        }
        yield* runIgnore("launchctl", ["unload", "-w", plistPath]);
      }
    } else if (environment.platform === "linux") {
      for (const unit of LINUX_SYSTEMD_UNITS) {
        yield* runIgnore("systemctl", ["--user", "disable", "--now", unit]);
      }
      yield* runIgnore("systemctl", ["--user", "daemon-reload"]);
    }
  });

  const buildPlan = Effect.gen(function* () {
    const userDataPath = yield* appIdentity.resolveUserDataPath.pipe(
      Effect.mapError((error) => new DesktopUninstallError({ message: error.message })),
    );
    const candidates = collectDesktopUninstallCandidates({
      path: environment.path,
      platform: environment.platform,
      isPackaged: environment.isPackaged,
      executablePath,
      homeDirectory: environment.homeDirectory,
      appDataDirectory: environment.appDataDirectory,
      baseDir: environment.baseDir,
      userDataPath,
      linuxApplicationsDir: environment.linuxApplicationsDir,
      linuxDesktopEntryName: environment.linuxDesktopEntryName,
      appImagePath: environment.appImagePath,
      env,
    });

    const existingPaths: Array<string> = [];
    for (const candidate of candidates.paths) {
      if (yield* exists(candidate)) {
        existingPaths.push(candidate);
      }
    }

    let hasBackgroundService = false;
    for (const unitPath of candidates.serviceUnitPaths) {
      if (yield* exists(unitPath)) {
        hasBackgroundService = true;
        break;
      }
    }

    const cliState = yield* cliCommand.state;

    const plan: DesktopUninstallPlan = {
      supported: true,
      isPackaged: environment.isPackaged,
      appBundlePath:
        candidates.appBundlePath !== null && (yield* exists(candidates.appBundlePath))
          ? candidates.appBundlePath
          : null,
      baseDir: environment.baseDir,
      paths: existingPaths,
      hasBackgroundService,
      cliCommandPath: cliState.installedPath,
    };
    return plan;
  });

  const run = Effect.gen(function* () {
    const plan = yield* buildPlan;
    yield* logInfo("starting complete desktop uninstall", {
      pathCount: plan.paths.length,
      hasBackgroundService: plan.hasBackgroundService,
      cliCommandPath: plan.cliCommandPath,
      appBundlePath: plan.appBundlePath,
    });

    // 1. Remove the installed CLI command and any PATH entry we added.
    if (plan.cliCommandPath !== null) {
      yield* cliCommand.uninstall.pipe(
        Effect.catch((error) =>
          logWarning("failed to uninstall CLI command during complete uninstall", {
            error: error.message,
          }),
        ),
      );
    }

    // 2. Unload/disable any OS background service before deleting its files.
    yield* stopBackgroundServices;

    // 3. Stop all pooled local backend instances cleanly so SQLite databases close.
    const instances = yield* backendPool.list;
    yield* Effect.forEach(
      instances,
      (instance) =>
        instance
          .stop({ timeout: DesktopBackendManager.BACKEND_QUIT_STOP_TIMEOUT })
          .pipe(Effect.ignore),
      { concurrency: "unbounded" },
    );

    // 4. Spawn detached cleanup helper that deletes all M3 Code paths once Electron exits.
    yield* spawnDetachedDesktopCleanup({
      platform: environment.platform,
      pid: process.pid,
      paths: plan.paths,
      env,
    });

    // 5. Request clean app shutdown and quit Electron.
    yield* shutdown.request;
    yield* electronApp.quit;
  }).pipe(Effect.withSpan("desktop.uninstall.run"));

  return DesktopUninstall.of({
    getPlan: buildPlan.pipe(Effect.withSpan("desktop.uninstall.getPlan")),
    run,
  });
});

export const layer = Layer.effect(DesktopUninstall, make);
