import { applyCommitTrailers } from "./commit-trailers.js";
import { type AttributionResolution } from "./context-store.js";
import { type GitHookName } from "./git-hooks.js";
import type { AttributionPaths } from "./paths.js";
import { type ProcessSnapshot } from "./process-origin.js";
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
export declare function runGitHook(hookName: GitHookName, args: string[], paths: AttributionPaths, dependencies?: HookRunnerDependencies): GitHookRunResult;
export declare function createHookChainer(paths: AttributionPaths, workingDirectory?: string, readStdin?: () => Buffer): (hookName: GitHookName, args: string[]) => number;
export {};
//# sourceMappingURL=git-hook-runner.d.ts.map