import { spawnSync } from "node:child_process";
import { accessSync, chmodSync, constants, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { GIT_HOOK_NAMES } from "./git-hooks.js";
const INSTALL_SCHEMA_VERSION = 1;
export function installDispatcher(input) {
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
export function uninstallDispatcher(input) {
    const gitConfig = input.gitConfig ?? createGitConfig();
    const state = readInstallState(input.paths.installStatePath);
    if (state === undefined) {
        throw new Error("OpenClaw Must Win is not set up for this user");
    }
    const currentHooksPath = gitConfig.getGlobalHooksPath();
    if (currentHooksPath !== state.hooksDirectory) {
        throw new Error(`core.hooksPath is ${currentHooksPath ?? "unset"}; refusing to overwrite a newer Git configuration`);
    }
    if (state.previousHooksPath === undefined) {
        gitConfig.unsetGlobalHooksPath();
    }
    else {
        gitConfig.setGlobalHooksPath(state.previousHooksPath);
    }
    rmSync(input.paths.dataDirectory, { force: true, recursive: true });
    rmSync(input.paths.installStatePath, { force: true });
    removeEmptyDirectory(input.paths.stateDirectory);
}
export function doctorDispatcher(input) {
    const errors = checkPlatform(input.platform ?? process.platform);
    const warnings = [];
    const state = readInstallState(input.paths.installStatePath);
    checkInstalledFiles(state, errors);
    checkGitConfiguration(input.gitConfig ?? createGitConfig(), state, errors);
    if (state?.previousHooksPath !== undefined) {
        warnings.push(`previous global hooks remain chained from ${state.previousHooksPath}`);
    }
    return { errors, ok: errors.length === 0, warnings };
}
function resolveHooksState(gitConfig, paths) {
    const existingState = readInstallState(paths.installStatePath);
    const currentHooksPath = gitConfig.getGlobalHooksPath();
    if (existingState?.hooksDirectory === paths.hooksDirectory &&
        currentHooksPath !== paths.hooksDirectory) {
        throw new Error(`core.hooksPath changed after setup (${currentHooksPath ?? "unset"}); run doctor before reinstalling`);
    }
    const previousHooksPath = currentHooksPath === paths.hooksDirectory ? existingState?.previousHooksPath : currentHooksPath;
    return { currentHooksPath, previousHooksPath };
}
function installRuntimeAndHooks(input) {
    const runtimeEntry = join(input.runtimeDirectory, "cli.js");
    copyRuntime(input.sourceRuntimeDirectory, input.runtimeDirectory);
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
function createInstallState(input) {
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
function applyGlobalHooksPath(gitConfig, hooksDirectory, previousHooksPath) {
    try {
        gitConfig.setGlobalHooksPath(hooksDirectory);
    }
    catch (error) {
        restoreGlobalHooksPath(gitConfig, previousHooksPath);
        throw error;
    }
}
function restoreGlobalHooksPath(gitConfig, hooksPath) {
    if (hooksPath === undefined) {
        gitConfig.unsetGlobalHooksPath();
    }
    else {
        gitConfig.setGlobalHooksPath(hooksPath);
    }
}
function checkPlatform(platform) {
    return platform === "linux" ? [] : ["process-origin checks require Linux /proc and cgroup v2"];
}
function checkInstalledFiles(state, errors) {
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
    const missingHook = GIT_HOOK_NAMES.map((name) => join(state.hooksDirectory, name)).find((path) => !isExecutable(path));
    if (missingHook) {
        errors.push(`Git hook is unavailable or not executable: ${missingHook}`);
    }
}
function checkGitConfiguration(gitConfig, state, errors) {
    const currentHooksPath = gitConfig.getGlobalHooksPath();
    if (state !== undefined && currentHooksPath !== state.hooksDirectory) {
        errors.push(`global core.hooksPath is ${currentHooksPath ?? "unset"}; expected ${state.hooksDirectory}`);
    }
    const localHooksPath = gitConfig.getLocalHooksPath?.();
    if (localHooksPath !== undefined) {
        errors.push(`repository core.hooksPath overrides the dispatcher (${localHooksPath}); remove the local override`);
    }
}
export function readInstallState(path) {
    try {
        const value = JSON.parse(readFileSync(path, "utf8"));
        return isInstallState(value) ? value : undefined;
    }
    catch {
        return undefined;
    }
}
function copyRuntime(source, target) {
    const sourcePath = resolve(source);
    const targetPath = resolve(target);
    if (sourcePath === targetPath) {
        return;
    }
    rmSync(targetPath, { force: true, recursive: true });
    mkdirPrivate(dirname(targetPath));
    cpSync(sourcePath, targetPath, { recursive: true });
}
function buildHookScript(nodeExecutable, runtimeEntry, hookName) {
    return `#!/bin/sh\nif [ ! -f ${shellQuote(runtimeEntry)} ]; then\n  printf '%s\\n' 'openclaw-must-win: hook runtime is missing; run setup or uninstall' >&2\n  exit 1\nfi\nexec ${shellQuote(nodeExecutable)} ${shellQuote(runtimeEntry)} hook ${shellQuote(hookName)} "$@"\n`;
}
function createGitConfig() {
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
function readHooksPath(args, missingStatuses) {
    const result = spawnSync("git", args, { encoding: "utf8" });
    if (result.status !== null && missingStatuses.includes(result.status)) {
        return undefined;
    }
    assertCommandSucceeded(result, "read core.hooksPath");
    const value = result.stdout.trim();
    return value || undefined;
}
function assertCommandSucceeded(result, operation) {
    if (result.error) {
        throw result.error;
    }
    if (result.status !== 0) {
        const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
        throw new Error(`${operation} failed${stderr ? `: ${stderr}` : ""}`);
    }
}
function mkdirPrivate(path) {
    mkdirSync(path, { mode: 0o700, recursive: true });
    chmodSync(path, 0o700);
}
function writePrivateJson(path, value) {
    const directory = dirname(path);
    mkdirPrivate(directory);
    const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
}
function removeEmptyDirectory(path) {
    try {
        rmSync(path, { recursive: false });
    }
    catch {
        // Leave non-empty state directories intact.
    }
}
function isExecutable(path) {
    try {
        accessSync(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function shellQuote(value) {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}
function isInstallState(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }
    const record = value;
    const requiredStrings = ["hooksDirectory", "installedAt", "nodeExecutable", "runtimeEntry"];
    return (record["schemaVersion"] === INSTALL_SCHEMA_VERSION &&
        requiredStrings.every((field) => typeof record[field] === "string") &&
        isOptionalString(record["previousHooksPath"]));
}
function isOptionalString(value) {
    return value === undefined || typeof value === "string";
}
//# sourceMappingURL=installer.js.map