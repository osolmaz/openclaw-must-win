import { spawnSync } from "node:child_process";
import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { applyCommitTrailers } from "./commit-trailers.js";
import { AttributionContextStore, type AttributionResolution } from "./context-store.js";
import { isMessageHook, type GitHookName } from "./git-hooks.js";
import { readInstallState, type InstallState } from "./installer.js";
import type { AttributionPaths } from "./paths.js";
import { readProcessSnapshot, type ProcessSnapshot } from "./process-origin.js";

export type GitHookRunResult = {
  message?: string;
  status: number;
};

type HookRunnerDependencies = {
  applyTrailers?: typeof applyCommitTrailers;
  chainHooks?: (hookName: GitHookName, args: string[]) => number;
  readSnapshot?: () => ProcessSnapshot | undefined;
  resolveContext?: (snapshot: ProcessSnapshot) => AttributionResolution;
};

export function runGitHook(
  hookName: GitHookName,
  args: string[],
  paths: AttributionPaths,
  dependencies: HookRunnerDependencies = {},
): GitHookRunResult {
  const resolution = resolveHookContext(paths, dependencies);
  const chainStatus = (dependencies.chainHooks ?? createHookChainer(paths))(hookName, args);
  if (chainStatus !== 0) {
    return { status: chainStatus };
  }
  const contextFailure = requiredContextFailure(hookName, resolution);
  if (contextFailure) {
    return contextFailure;
  }
  if (!shouldApplyTrailers(hookName, resolution)) {
    return { status: 0 };
  }
  return applyResolvedTrailers(args[0], resolution.ticket, dependencies.applyTrailers);
}

export function createHookChainer(
  paths: AttributionPaths,
  workingDirectory = process.cwd(),
  readStdin: () => Buffer = () => readFileSync(0),
) {
  return (hookName: GitHookName, args: string[]): number => {
    const state = readInstallState(paths.installStatePath);
    const candidates = resolveDelegatedHooks(state, hookName, workingDirectory);
    const input = hookReadsStdin(hookName) && candidates.length > 0 ? readStdin() : undefined;
    for (const candidate of candidates) {
      const status = runDelegatedHook(candidate, args, input);
      if (status !== 0) {
        return status;
      }
    }
    return 0;
  };
}

function resolveHookContext(
  paths: AttributionPaths,
  dependencies: HookRunnerDependencies,
): AttributionResolution {
  const snapshot = (dependencies.readSnapshot ?? (() => readProcessSnapshot()))();
  if (snapshot === undefined) {
    return { origin: "terminal" };
  }
  const resolver =
    dependencies.resolveContext ??
    ((value: ProcessSnapshot) => new AttributionContextStore(paths).resolve(value));
  return resolver(snapshot);
}

function requiredContextFailure(
  hookName: GitHookName,
  resolution: AttributionResolution,
): GitHookRunResult | undefined {
  if (!isMessageHook(hookName) || resolution.origin !== "openclaw" || !("reason" in resolution)) {
    return undefined;
  }
  return resolution.mode === "required"
    ? {
        message: `openclaw-must-win: refusing unattributed commit (${resolution.reason} execution context)`,
        status: 1,
      }
    : undefined;
}

function shouldApplyTrailers(
  hookName: GitHookName,
  resolution: AttributionResolution,
): resolution is Extract<AttributionResolution, { ticket: unknown }> {
  return isMessageHook(hookName) && resolution.origin === "openclaw" && "ticket" in resolution;
}

function applyResolvedTrailers(
  messageFile: string | undefined,
  ticket: Extract<AttributionResolution, { ticket: unknown }>["ticket"],
  applyTrailers: typeof applyCommitTrailers = applyCommitTrailers,
): GitHookRunResult {
  if (!messageFile) {
    return {
      message: "openclaw-must-win: Git message hook did not provide a message file",
      status: 1,
    };
  }
  try {
    applyTrailers(messageFile, ticket.model, ticket.openClawVersion);
    return { status: 0 };
  } catch (error) {
    return {
      message: `openclaw-must-win: could not apply attribution: ${formatError(error)}`,
      status: 1,
    };
  }
}

function resolveHookCandidates(
  state: InstallState | undefined,
  hookName: GitHookName,
  workingDirectory: string,
): string[] {
  return [
    resolvePreviousHook(state?.previousHooksPath, hookName, workingDirectory),
    resolveRepositoryHook(hookName, workingDirectory),
  ].filter((path): path is string => path !== undefined);
}

function resolveDelegatedHooks(
  state: InstallState | undefined,
  hookName: GitHookName,
  workingDirectory: string,
): string[] {
  const seen = new Set<string>();
  return resolveHookCandidates(state, hookName, workingDirectory)
    .map((candidate) => resolve(candidate))
    .filter((candidate) => {
      if (shouldSkipHook(candidate, state, seen)) {
        return false;
      }
      seen.add(candidate);
      return true;
    });
}

function shouldSkipHook(path: string, state: InstallState | undefined, seen: Set<string>): boolean {
  return (
    (state !== undefined && path.startsWith(`${resolve(state.hooksDirectory)}/`)) ||
    seen.has(path) ||
    !isExecutable(path)
  );
}

function runDelegatedHook(path: string, args: string[], input: Buffer | undefined): number {
  const result = spawnSync(path, args, {
    ...(input === undefined
      ? { stdio: "inherit" as const }
      : { input, stdio: ["pipe", "inherit", "inherit"] }),
  });
  if (result.error) {
    process.stderr.write(`openclaw-must-win: ${formatError(result.error)}\n`);
    return 1;
  }
  return result.status ?? 1;
}

function hookReadsStdin(hookName: GitHookName): boolean {
  return (
    hookName === "post-receive" ||
    hookName === "post-rewrite" ||
    hookName === "pre-push" ||
    hookName === "pre-receive" ||
    hookName === "proc-receive" ||
    hookName === "reference-transaction"
  );
}

function resolvePreviousHook(
  previousHooksPath: string | undefined,
  hookName: string,
  workingDirectory: string,
) {
  if (!previousHooksPath) {
    return undefined;
  }
  const expanded = previousHooksPath.startsWith("~/")
    ? join(homedir(), previousHooksPath.slice(2))
    : previousHooksPath;
  return join(isAbsolute(expanded) ? expanded : resolve(workingDirectory, expanded), hookName);
}

function resolveRepositoryHook(hookName: string, workingDirectory: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: workingDirectory,
    encoding: "utf8",
  });
  if (result.error || result.status !== 0) {
    return undefined;
  }
  const commonDirectory = result.stdout.trim();
  if (!commonDirectory) {
    return undefined;
  }
  const absoluteDirectory = isAbsolute(commonDirectory)
    ? commonDirectory
    : resolve(workingDirectory, commonDirectory);
  return join(absoluteDirectory, "hooks", hookName);
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
