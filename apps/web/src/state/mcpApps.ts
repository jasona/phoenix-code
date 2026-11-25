import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";
import type { EnvironmentId, PluginScope } from "@t3tools/contracts";
import { createMcpAppEnvironmentAtoms } from "@t3tools/client-runtime/state/mcp-apps";

import { connectionAtomRuntime } from "../connection/runtime";

export const mcpAppEnvironment = createMcpAppEnvironmentAtoms(connectionAtomRuntime);

const isInstance = Schema.is(Schema.Struct({ instanceId: Schema.String }));
export const pluginViewAtom = Atom.family((key: string) => {
  const [environmentId, pluginId, viewId, scope] = JSON.parse(key) as [
    EnvironmentId,
    string,
    string,
    PluginScope | undefined,
  ];
  return Atom.make((get) =>
    mcpAppEnvironment.pluginsRequest
      .run(get.registry, {
        environmentId,
        input: { action: "open", pluginId, viewId, ...(scope ? { scope } : {}) },
      })
      .pipe(
        Effect.tap((result) =>
          Effect.sync(() => {
            if (isInstance(result))
              get.addFinalizer(() => {
                Effect.runFork(
                  mcpAppEnvironment.pluginsRequest
                    .run(get.registry, {
                      environmentId,
                      input: { action: "release", pluginId, instanceId: result.instanceId },
                    })
                    .pipe(Effect.ignore),
                );
              });
          }),
        ),
      ),
  ).pipe(Atom.setIdleTTL(0));
});
