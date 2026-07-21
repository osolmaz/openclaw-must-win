import { spawnSync } from "node:child_process";
import {
  accessSync,
  chmodSync,
  constants,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { GIT_HOOK_NAMES } from "./git-hooks.js";
import type { AttributionPaths } from "./paths.js";

const INSTALL_SCHEMA_VERSION = 1;

export type InstallState = {
  hooksDirectory: string;
  installedAt: string;
  nodeExecutable: string;
  previousHooksPath?: string;
  runtimeEntry: string;
  schemaVersion: 1;
};

export type DoctorResult = {
  errors: string[];
  ok: boolean;
  warnings: string[];
};

type GitConfig = {
  getGlobalHooksPath: () => string | undefined;
  getLocalHooksPath?: () => string | undefined;
  setGlobalHooksPath: (value: string) => void;
  unsetGlobalHooksPath: () => void;
};

export function installDispatcher(input: {
  gitConfig?: GitConfig;
  nodeExecutable?: string;
  paths: AttributionPaths;
  sourceRuntimeDirectory: string;
}): InstallState {
  const gitConfig = input.gitConfig ?? createGitConfig();
  const hooksState = resolveHooksState(gitConfig, input.paths);
  const nodeExecutable = input.nodeExecutable ?? process.execPath;
  const runtimeEntry = installRuntimeAndHooks({
    hooksDirectory: input.paths.hooksDirectory,
    nodeExecutable,
    runtimeDirectory: input.paths.runtimeFilesDirectory,
    sourceRuntimeDirectory: input.sourceRuntimeDirectory,
  });
  const state = createInstallState({
    hooksDirectory: input.paths.hooksDirectory,
    nodeExecutable,
    ...(hooksState.previousHooksPath === undefined
      ? {}
      : { previousHooksPath: hooksState.previousHooksPath }),
    runtimeEntry,
  });
  writePrivateJson(input.paths.installStatePath, state);
  applyGlobalHooksPath(gitConfig, input.paths.hooksDirectory, hooksState.currentHooksPath);
  return state;
}

export function uninstallDispatcher(input: {
  gitConfig?: GitConfig;
  paths: AttributionPaths;
}): void {
  const gitConfig = input.gitConfig ?? createGitConfig();
  const state = readInstallState(input.paths.installStatePath);
  if (state === undefined) {
    throw new Error("OpenClaw Must Win is not set up for this user");
  }
  const currentHooksPath = gitConfig.getGlobalHooksPath();
  if (currentHooksPath !== state.hooksDirectory) {
    throw new Error(
      `core.hooksPath is ${currentHooksPath ?? "unset"}; refusing to overwrite a newer Git configuration`,
    );
  }
  if (state.previousHooksPath === undefined) {
    gitConfig.unsetGlobalHooksPath();
  } else {
    gitConfig.setGlobalHooksPath(state.previousHooksPath);
  }
  rmSync(input.paths.dataDirectory, { force: true, recursive: true });
  rmSync(input.paths.installStatePath, { force: true });
  removeEmptyDirectory(input.paths.stateDirectory);
}

export function doctorDispatcher(input: {
  gitConfig?: GitConfig;
  paths: AttributionPaths;
  platform?: NodeJS.Platform;
}): DoctorResult {
  const errors = checkPlatform(input.platform ?? process.platform);
  const warnings: string[] = [];
  const state = readInstallState(input.paths.installStatePath);
  checkInstalledFiles(state, errors);
  checkGitConfiguration(input.gitConfig ?? createGitConfig(), state, errors);
  if (state?.previousHooksPath !== undefined) {
    warnings.push(`previous global hooks remain chained from ${state.previousHooksPath}`);
  }
  return { errors, ok: errors.length === 0, warnings };
}

function resolveHooksState(gitConfig: GitConfig, paths: AttributionPaths) {
  const existingState = readInstallState(paths.installStatePath);
  const currentHooksPath = gitConfig.getGlobalHooksPath();
  if (
    existingState?.hooksDirectory === paths.hooksDirectory &&
    currentHooksPath !== paths.hooksDirectory
  ) {
    throw new Error(
      `core.hooksPath changed after setup (${currentHooksPath ?? "unset"}); run doctor before reinstalling`,
    );
  }
  const previousHooksPath =
    currentHooksPath === paths.hooksDirectory ? existingState?.previousHooksPath : currentHooksPath;
  return { currentHooksPath, previousHooksPath };
}

function installRuntimeAndHooks(input: {
  hooksDirectory: string;
  nodeExecutable: string;
  runtimeDirectory: string;
  sourceRuntimeDirectory: string;
}): string {
  const runtimeEntry = join(input.runtimeDirectory, "cli.js");
  copyRuntime(input.sourceRuntimeDirectory, input.runtimeDirectory);
  writeFileSync(join(input.runtimeDirectory, "package.json"), '{"type":"module"}\n', {
    mode: 0o600,
  });
  if (!existsSync(runtimeEntry)) {
    throw new Error(`compiled hook runtime is missing: ${runtimeEntry}`);
  }
  mkdirPrivate(input.hooksDirectory);
  for (const hookName of GIT_HOOK_NAMES) {
    const hookPath = join(input.hooksDirectory, hookName);
    writeFileSync(hookPath, buildHookScript(input.nodeExecutable, runtimeEntry, hookName), {
      mode: 0o755,
    });
    chmodSync(hookPath, 0o755);
  }
  return runtimeEntry;
}

function createInstallState(input: {
  hooksDirectory: string;
  nodeExecutable: string;
  previousHooksPath?: string;
  runtimeEntry: string;
}): InstallState {
  return {
    hooksDirectory: input.hooksDirectory,
    installedAt: new Date().toISOString(),
    nodeExecutable: input.nodeExecutable,
    ...(input.previousHooksPath === undefined
      ? {}
      : { previousHooksPath: input.previousHooksPath }),
    runtimeEntry: input.runtimeEntry,
    schemaVersion: INSTALL_SCHEMA_VERSION,
  };
}

function applyGlobalHooksPath(
  gitConfig: GitConfig,
  hooksDirectory: string,
  previousHooksPath: string | undefined,
): void {
  try {
    gitConfig.setGlobalHooksPath(hooksDirectory);
  } catch (error) {
    restoreGlobalHooksPath(gitConfig, previousHooksPath);
    throw error;
  }
}

function restoreGlobalHooksPath(gitConfig: GitConfig, hooksPath: string | undefined): void {
  if (hooksPath === undefined) {
    gitConfig.unsetGlobalHooksPath();
  } else {
    gitConfig.setGlobalHooksPath(hooksPath);
  }
}

function checkPlatform(platform: NodeJS.Platform): string[] {
  return platform === "linux" ? [] : ["process-origin checks require Linux /proc and cgroup v2"];
}

function checkInstalledFiles(state: InstallState | undefined, errors: string[]): void {
  if (state === undefined) {
    errors.push("setup state is missing; run openclaw-must-win setup");
    return;
  }
  if (!isExecutable(state.nodeExecutable)) {
    errors.push(`Node executable is unavailable: ${state.nodeExecutable}`);
  }
  if (!existsSync(state.runtimeEntry)) {
    errors.push(`hook runtime is unavailable: ${state.runtimeEntry}`);
  }
  const missingHook = GIT_HOOK_NAMES.map((name) => join(state.hooksDirectory, name)).find(
    (path) => !isExecutable(path),
  );
  if (missingHook) {
    errors.push(`Git hook is unavailable or not executable: ${missingHook}`);
  }
}

function checkGitConfiguration(
  gitConfig: GitConfig,
  state: InstallState | undefined,
  errors: string[],
): void {
  const currentHooksPath = gitConfig.getGlobalHooksPath();
  if (state !== undefined && currentHooksPath !== state.hooksDirectory) {
    errors.push(
      `global core.hooksPath is ${currentHooksPath ?? "unset"}; expected ${state.hooksDirectory}`,
    );
  }
  const localHooksPath = gitConfig.getLocalHooksPath?.();
  if (localHooksPath !== undefined) {
    errors.push(
      `repository core.hooksPath overrides the dispatcher (${localHooksPath}); remove the local override`,
    );
  }
}

export function readInstallState(path: string): InstallState | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    return isInstallState(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function copyRuntime(source: string, target: string): void {
  const sourcePath = resolve(source);
  const targetPath = resolve(target);
  if (sourcePath === targetPath) {
    return;
  }
  rmSync(targetPath, { force: true, recursive: true });
  mkdirPrivate(dirname(targetPath));
  cpSync(sourcePath, targetPath, { recursive: true });
}

function buildHookScript(nodeExecutable: string, runtimeEntry: string, hookName: string): string {
  return `#!/bin/sh\nif [ ! -f ${shellQuote(runtimeEntry)} ]; then\n  printf '%s\\n' 'openclaw-must-win: hook runtime is missing; run setup or uninstall' >&2\n  exit 1\nfi\nexec ${shellQuote(nodeExecutable)} ${shellQuote(runtimeEntry)} hook ${shellQuote(hookName)} "$@"\n`;
}

function createGitConfig(): GitConfig {
  return {
    getGlobalHooksPath() {
      return readHooksPath(["config", "--global", "--get", "core.hooksPath"], [1]);
    },
    getLocalHooksPath() {
      return readHooksPath(["config", "--local", "--get", "core.hooksPath"], [1, 128]);
    },
    setGlobalHooksPath(value) {
      const result = spawnSync("git", ["config", "--global", "core.hooksPath", value], {
        encoding: "utf8",
      });
      assertCommandSucceeded(result, "set global core.hooksPath");
    },
    unsetGlobalHooksPath() {
      const result = spawnSync("git", ["config", "--global", "--unset-all", "core.hooksPath"], {
        encoding: "utf8",
      });
      if (result.status !== 0 && result.status !== 5) {
        assertCommandSucceeded(result, "unset global core.hooksPath");
      }
    },
  };
}

function readHooksPath(args: string[], missingStatuses: number[]): string | undefined {
  const result = spawnSync("git", args, { encoding: "utf8" });
  if (result.status !== null && missingStatuses.includes(result.status)) {
    return undefined;
  }
  assertCommandSucceeded(result, "read core.hooksPath");
  const value = result.stdout.trim();
  return value || undefined;
}

function assertCommandSucceeded(result: ReturnType<typeof spawnSync>, operation: string): void {
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(`${operation} failed${stderr ? `: ${stderr}` : ""}`);
  }
}

function mkdirPrivate(path: string): void {
  mkdirSync(path, { mode: 0o700, recursive: true });
  chmodSync(path, 0o700);
}

function writePrivateJson(path: string, value: unknown): void {
  const directory = dirname(path);
  mkdirPrivate(directory);
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  chmodSync(path, 0o600);
}

function removeEmptyDirectory(path: string): void {
  try {
    rmSync(path, { recursive: false });
  } catch {
    // Leave non-empty state directories intact.
  }
}

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function isInstallState(value: unknown): value is InstallState {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const requiredStrings = ["hooksDirectory", "installedAt", "nodeExecutable", "runtimeEntry"];
  return (
    record["schemaVersion"] === INSTALL_SCHEMA_VERSION &&
    requiredStrings.every((field) => typeof record[field] === "string") &&
    isOptionalString(record["previousHooksPath"])
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}
