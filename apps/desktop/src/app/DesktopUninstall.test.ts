import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import {
  collectDesktopUninstallCandidates,
  isSafeRemovalPath,
  resolveMacAppBundlePath,
} from "./DesktopUninstall.ts";

it.layer(NodeServices.layer)("DesktopUninstall path resolution", (it) => {
  it.effect("resolves the enclosing macOS .app bundle from an executable path", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      assert.equal(
        resolveMacAppBundlePath(path, "/Applications/Phoenix (Beta).app/Contents/MacOS/Phoenix"),
        "/Applications/Phoenix (Beta).app",
      );
      assert.isNull(resolveMacAppBundlePath(path, "/usr/local/bin/node"));
    }),
  );

  it.effect(
    "refuses to mark root, home, or shared OS container directories as safe to remove",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = "/Users/alice";
        const appData = "/Users/alice/Library/Application Support";
        for (const unsafe of [
          "/",
          home,
          "/Applications",
          `${home}/Applications`,
          `${home}/Library`,
          appData,
          `${home}/Library/Caches`,
          `${home}/Library/Preferences`,
          `${home}/Library/LaunchAgents`,
          `${home}/.config`,
          `${home}/.cache`,
        ]) {
          assert.isFalse(
            isSafeRemovalPath({
              path,
              candidate: unsafe,
              homeDirectory: home,
              appDataDirectory: appData,
            }),
            `expected ${unsafe} to be rejected`,
          );
        }
        assert.isTrue(
          isSafeRemovalPath({
            path,
            candidate: `${home}/.m3`,
            homeDirectory: home,
            appDataDirectory: appData,
          }),
        );
        assert.isTrue(
          isSafeRemovalPath({
            path,
            candidate: "/Applications/Phoenix (Beta).app",
            homeDirectory: home,
            appDataDirectory: appData,
          }),
        );
      }),
  );

  it.effect(
    "collects macOS packaged bundle, baseDir, userData, caches, preferences, and launch agent",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = "/Users/alice";
        const appData = `${home}/Library/Application Support`;
        const result = collectDesktopUninstallCandidates({
          path,
          platform: "darwin",
          isPackaged: true,
          executablePath: "/Applications/Phoenix (Beta).app/Contents/MacOS/Phoenix",
          homeDirectory: home,
          appDataDirectory: appData,
          baseDir: `${home}/.m3`,
          userDataPath: `${appData}/t3code-v2`,
          linuxApplicationsDir: `${home}/.local/share/applications`,
          linuxDesktopEntryName: "com.m3code.m3code.desktop",
          appImagePath: Option.none(),
          env: {},
        });

        assert.equal(result.appBundlePath, "/Applications/Phoenix (Beta).app");
        assert.include(result.paths, "/Applications/Phoenix (Beta).app");
        assert.include(result.paths, `${home}/.m3`);
        assert.include(result.paths, `${appData}/t3code-v2`);
        assert.include(result.paths, `${home}/Library/Caches/com.m3code.m3code`);
        assert.include(result.paths, `${home}/Library/Preferences/com.m3code.m3code.plist`);
        assert.include(
          result.paths,
          `${home}/Library/Saved Application State/com.m3code.m3code.savedState`,
        );
        assert.include(
          result.paths,
          `${home}/Library/LaunchAgents/com.m3code.m3code.service.plist`,
        );
      }),
  );

  it.effect("never includes an app bundle in development mode", () =>
    Effect.gen(function* () {
      const path = yield* Path.Path;
      const home = "/Users/alice";
      const appData = `${home}/Library/Application Support`;
      const result = collectDesktopUninstallCandidates({
        path,
        platform: "darwin",
        isPackaged: false,
        executablePath:
          "/repo/apps/desktop/.electron-runtime/Phoenix (Dev).app/Contents/MacOS/Electron",
        homeDirectory: home,
        appDataDirectory: appData,
        baseDir: `${home}/.m3`,
        userDataPath: `${appData}/t3code-dev`,
        linuxApplicationsDir: `${home}/.local/share/applications`,
        linuxDesktopEntryName: "com.m3code.m3code.desktop",
        appImagePath: Option.none(),
        env: {},
      });

      assert.isNull(result.appBundlePath);
      assert.notInclude(result.paths, "/repo/apps/desktop/.electron-runtime/Phoenix (Dev).app");
    }),
  );

  it.effect(
    "collects Linux AppImage, caches, desktop entries, GNOME extension, and systemd unit",
    () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const home = "/home/alice";
        const appData = `${home}/.config`;
        const result = collectDesktopUninstallCandidates({
          path,
          platform: "linux",
          isPackaged: true,
          executablePath: "/tmp/.mount_m3code/m3code",
          homeDirectory: home,
          appDataDirectory: appData,
          baseDir: `${home}/.m3`,
          userDataPath: `${appData}/t3code-v2`,
          linuxApplicationsDir: `${home}/.local/share/applications`,
          linuxDesktopEntryName: "com.m3code.m3code.desktop",
          appImagePath: Option.some(`${home}/Applications/M3Code.AppImage`),
          env: {},
        });

        assert.equal(result.appBundlePath, `${home}/Applications/M3Code.AppImage`);
        assert.include(result.paths, `${home}/Applications/M3Code.AppImage`);
        assert.include(result.paths, `${home}/.m3`);
        assert.include(result.paths, `${home}/.cache/m3code`);
        assert.include(result.paths, `${home}/.config/systemd/user/m3code.service`);
        assert.include(result.paths, `${home}/.local/share/applications/com.m3code.m3code.desktop`);
        assert.include(
          result.paths,
          `${home}/.local/share/gnome-shell/extensions/snap-shot@t3.codes`,
        );
      }),
  );

  it.effect("silently filters out unsafe baseDir equal to homeDirectory", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const home = yield* fs.makeTempDirectoryScoped({ prefix: "m3-uninstall-safe-" });
      const result = collectDesktopUninstallCandidates({
        path,
        platform: "linux",
        isPackaged: false,
        executablePath: "/usr/bin/node",
        homeDirectory: home,
        appDataDirectory: path.join(home, ".config"),
        baseDir: home,
        userDataPath: path.join(home, ".config", "t3code-v2"),
        linuxApplicationsDir: path.join(home, ".local", "share", "applications"),
        linuxDesktopEntryName: "com.m3code.m3code.desktop",
        appImagePath: Option.none(),
        env: {},
      });
      assert.notInclude(result.paths, path.resolve(home));
    }),
  );
});
