import { spawnSync } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { applyCommitTrailers } from "./commit-trailers.js";
import { AttributionContextStore } from "./context-store.js";
import { isMessageHook } from "./git-hooks.js";
import { readInstallState } from "./installer.js";
import { readProcessSnapshot } from "./process-origin.js";
export function runGitHook(hookName, args, paths, dependencies = {}) {
    const resolution = resolveHookContext(paths, dependencies);
    const contextFailure = requiredContextFailure(hookName, resolution);
    if (contextFailure) {
        return contextFailure;
    }
    const chainStatus = (dependencies.chainHooks ?? createHookChainer(paths))(hookName, args);
    if (chainStatus !== 0) {
        return { status: chainStatus };
    }
    if (!shouldApplyTrailers(hookName, resolution)) {
        return { status: 0 };
    }
    return applyResolvedTrailers(args[0], resolution.ticket, dependencies.applyTrailers);
}
export function createHookChainer(paths, workingDirectory = process.cwd()) {
    return (hookName, args) => {
        const state = readInstallState(paths.installStatePath);
        if (state === undefined) {
            return 0;
        }
        const seen = new Set();
        for (const candidate of resolveHookCandidates(state, hookName, workingDirectory)) {
            const normalized = resolve(candidate);
            if (shouldSkipHook(normalized, state, seen)) {
                continue;
            }
            seen.add(normalized);
            const status = runDelegatedHook(normalized, args);
            if (status !== 0) {
                return status;
            }
        }
        return 0;
    };
}
function resolveHookContext(paths, dependencies) {
    const snapshot = (dependencies.readSnapshot ?? (() => readProcessSnapshot()))();
    if (snapshot === undefined) {
        return { origin: "terminal" };
    }
    const resolver = dependencies.resolveContext ??
        ((value) => new AttributionContextStore(paths).resolve(value));
    return resolver(snapshot);
}
function requiredContextFailure(hookName, resolution) {
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
function shouldApplyTrailers(hookName, resolution) {
    return isMessageHook(hookName) && resolution.origin === "openclaw" && "ticket" in resolution;
}
function applyResolvedTrailers(messageFile, ticket, applyTrailers = applyCommitTrailers) {
    if (!messageFile) {
        return {
            message: "openclaw-must-win: Git message hook did not provide a message file",
            status: 1,
        };
    }
    try {
        applyTrailers(messageFile, ticket.model, ticket.openClawVersion);
        return { status: 0 };
    }
    catch (error) {
        return {
            message: `openclaw-must-win: could not apply attribution: ${formatError(error)}`,
            status: 1,
        };
    }
}
function resolveHookCandidates(state, hookName, workingDirectory) {
    return [
        resolvePreviousHook(state.previousHooksPath, hookName, workingDirectory),
        resolveRepositoryHook(hookName, workingDirectory),
    ].filter((path) => path !== undefined);
}
function shouldSkipHook(path, state, seen) {
    return (path.startsWith(`${resolve(state.hooksDirectory)}/`) || seen.has(path) || !isExecutable(path));
}
function runDelegatedHook(path, args) {
    const result = spawnSync(path, args, { stdio: "inherit" });
    if (result.error) {
        process.stderr.write(`openclaw-must-win: ${formatError(result.error)}\n`);
        return 1;
    }
    return result.status ?? 1;
}
function resolvePreviousHook(previousHooksPath, hookName, workingDirectory) {
    if (!previousHooksPath) {
        return undefined;
    }
    const expanded = previousHooksPath.startsWith("~/")
        ? join(homedir(), previousHooksPath.slice(2))
        : previousHooksPath;
    return join(isAbsolute(expanded) ? expanded : resolve(workingDirectory, expanded), hookName);
}
function resolveRepositoryHook(hookName, workingDirectory) {
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
function isExecutable(path) {
    try {
        accessSync(path, constants.X_OK);
        return true;
    }
    catch {
        return false;
    }
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=git-hook-runner.js.map