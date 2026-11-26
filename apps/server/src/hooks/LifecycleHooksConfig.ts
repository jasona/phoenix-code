// @effect-diagnostics nodeBuiltinImport:off -- Live mtime-cached hooks config loader runs synchronously on the fast-path guard.
import * as NodeFS from "node:fs";

const LIFECYCLE_HOOK_EVENTS = [
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PermissionRequest",
  "Notification",
  "Stop",
  "RunError",
  "Interrupt",
  "SessionEnd",
] as const;

export type LifecycleHookEventName = (typeof LIFECYCLE_HOOK_EVENTS)[number];

const LIFECYCLE_HOOK_EVENT_SET = new Set<string>(LIFECYCLE_HOOK_EVENTS);

const DEFAULT_HOOK_TIMEOUT_MS = 3_000;
const MIN_HOOK_TIMEOUT_MS = 500;
const MAX_HOOK_TIMEOUT_MS = 30_000;

export interface CompiledHookMatcher {
  readonly test: (target: string | undefined) => boolean;
}

export interface CompiledLifecycleHookEntry {
  readonly command: string;
  readonly timeoutMs: number;
  readonly matcher: CompiledHookMatcher | null;
}

export type LifecycleHooksConfig = Partial<
  Record<LifecycleHookEventName, ReadonlyArray<CompiledLifecycleHookEntry>>
>;

export interface MatchedLifecycleHook {
  readonly command: string;
  readonly timeoutMs: number;
}

export interface LifecycleHooksLoadResult {
  readonly config: LifecycleHooksConfig;
  readonly parseWarning?: string | undefined;
}

const EMPTY_CONFIG: LifecycleHooksConfig = {};

function normalizeTimeoutMs(rawTimeout: unknown): number {
  if (typeof rawTimeout !== "number" || !Number.isFinite(rawTimeout) || rawTimeout <= 0) {
    return DEFAULT_HOOK_TIMEOUT_MS;
  }
  // Claude/Codex `hooks.json` specifies `timeout` in seconds (e.g. 3 -> 3000ms),
  // whereas larger values (> 120) are treated as milliseconds.
  const ms = rawTimeout <= 120 ? Math.round(rawTimeout * 1_000) : Math.round(rawTimeout);
  return Math.min(MAX_HOOK_TIMEOUT_MS, Math.max(MIN_HOOK_TIMEOUT_MS, ms));
}

function compileMatcher(rawMatcher: unknown): CompiledHookMatcher | null {
  if (typeof rawMatcher !== "string") return null;
  const trimmed = rawMatcher.trim();
  if (!trimmed || trimmed === "*") return null;
  try {
    const regex = new RegExp(trimmed, "i");
    return {
      test: (target) => (target === undefined ? false : regex.test(target)),
    };
  } catch {
    const needle = trimmed.toLowerCase();
    return {
      test: (target) => (target === undefined ? false : target.toLowerCase().includes(needle)),
    };
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function extractCommandEntries(
  item: unknown,
  inheritedMatcher: CompiledHookMatcher | null,
): ReadonlyArray<CompiledLifecycleHookEntry> {
  if (!isPlainRecord(item)) return [];

  if (Array.isArray(item.hooks)) {
    const groupMatcher = compileMatcher(item.matcher) ?? inheritedMatcher;
    const nested: Array<CompiledLifecycleHookEntry> = [];
    for (const child of item.hooks) {
      nested.push(...extractCommandEntries(child, groupMatcher));
    }
    return nested;
  }

  const hookType = typeof item.type === "string" ? item.type.trim().toLowerCase() : "command";
  if (hookType !== "command") return [];

  const command = typeof item.command === "string" ? item.command.trim() : "";
  if (!command) return [];

  return [
    {
      command,
      timeoutMs: normalizeTimeoutMs(item.timeoutMs ?? item.timeout),
      matcher: compileMatcher(item.matcher) ?? inheritedMatcher,
    },
  ];
}

/** Parses a `hooks.json` document into compiled per-event command handlers. */
export function parseLifecycleHooksConfig(raw: string): LifecycleHooksConfig {
  const trimmed = raw.trim();
  if (!trimmed) return EMPTY_CONFIG;

  const parsed = JSON.parse(trimmed) as unknown;
  if (!isPlainRecord(parsed)) {
    throw new Error("hooks.json must contain a JSON object");
  }
  const hooksRoot = parsed.hooks;
  if (hooksRoot === undefined || hooksRoot === null) {
    return EMPTY_CONFIG;
  }
  if (!isPlainRecord(hooksRoot)) {
    throw new Error("hooks.json `hooks` property must be an object");
  }

  const config: Partial<Record<LifecycleHookEventName, ReadonlyArray<CompiledLifecycleHookEntry>>> =
    {};
  for (const [eventKey, entries] of Object.entries(hooksRoot)) {
    if (!LIFECYCLE_HOOK_EVENT_SET.has(eventKey) || !Array.isArray(entries)) {
      continue;
    }
    const compiled: Array<CompiledLifecycleHookEntry> = [];
    for (const entry of entries) {
      compiled.push(...extractCommandEntries(entry, null));
    }
    if (compiled.length > 0) {
      config[eventKey as LifecycleHookEventName] = compiled;
    }
  }
  return config;
}

/** Returns matching hook commands for `eventName` and optional matcher target (e.g. tool name). */
export function matchHooksForEvent(
  config: LifecycleHooksConfig,
  eventName: LifecycleHookEventName,
  matchTarget?: string,
): ReadonlyArray<MatchedLifecycleHook> {
  const entries = config[eventName];
  if (!entries || entries.length === 0) return [];
  const matched: Array<MatchedLifecycleHook> = [];
  for (const entry of entries) {
    if (entry.matcher && !entry.matcher.test(matchTarget)) continue;
    matched.push({ command: entry.command, timeoutMs: entry.timeoutMs });
  }
  return matched;
}

/** Creates an mtime-cached loader for `hooks.json` that throttles filesystem `stat` calls. */
export function makeLifecycleHooksConfigLoader(
  hooksConfigPath: string,
  options: {
    readonly statTtlMs?: number;
    readonly now?: () => number;
  } = {},
): {
  readonly load: () => LifecycleHooksLoadResult;
  readonly invalidate: () => void;
} {
  const statTtlMs = Math.max(0, options.statTtlMs ?? 1_000);
  const nowFn = options.now ?? (() => Date.now());

  let lastCheckAt = -Infinity;
  let lastMtimeMs: number | null = null;
  let lastSize: number | null = null;
  let cached: LifecycleHooksConfig = EMPTY_CONFIG;
  let lastWarnSignature: string | null = null;

  const invalidate = () => {
    lastCheckAt = -Infinity;
    lastMtimeMs = null;
    lastSize = null;
  };

  const load = (): LifecycleHooksLoadResult => {
    const now = nowFn();
    if (now - lastCheckAt < statTtlMs) {
      return { config: cached };
    }
    lastCheckAt = now;

    let stat: NodeFS.Stats;
    try {
      stat = NodeFS.statSync(hooksConfigPath);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "ENOTDIR") {
        lastMtimeMs = null;
        lastSize = null;
        cached = EMPTY_CONFIG;
        lastWarnSignature = null;
        return { config: EMPTY_CONFIG };
      }
      const message = err instanceof Error ? err.message : String(err);
      const signature = `stat:${message}`;
      const parseWarning = signature === lastWarnSignature ? undefined : message;
      lastWarnSignature = signature;
      return { config: cached, parseWarning };
    }

    if (lastMtimeMs === stat.mtimeMs && lastSize === stat.size) {
      return { config: cached };
    }

    lastMtimeMs = stat.mtimeMs;
    lastSize = stat.size;
    try {
      const raw = NodeFS.readFileSync(hooksConfigPath, "utf8");
      cached = parseLifecycleHooksConfig(raw);
      lastWarnSignature = null;
      return { config: cached };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      cached = EMPTY_CONFIG;
      const signature = `${stat.mtimeMs}:${stat.size}:${message}`;
      const parseWarning = signature === lastWarnSignature ? undefined : message;
      lastWarnSignature = signature;
      return { config: EMPTY_CONFIG, parseWarning };
    }
  };

  return { load, invalidate };
}
