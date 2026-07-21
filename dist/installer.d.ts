import type { AttributionPaths } from "./paths.js";
import { type ProcessIdentity } from "./process-origin.js";
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
    getEffectiveHooksPath?: () => string | undefined;
    getGlobalHooksPath: () => string | undefined;
    getLocalHooksPath?: () => string | undefined;
    setGlobalHooksPath: (value: string) => void;
    unsetGlobalHooksPath: () => void;
};
export declare function installDispatcher(input: {
    gitConfig?: GitConfig;
    nodeExecutable?: string;
    paths: AttributionPaths;
    sourceRuntimeDirectory: string;
}): InstallState;
export declare function uninstallDispatcher(input: {
    gitConfig?: GitConfig;
    paths: AttributionPaths;
}): void;
export declare function doctorDispatcher(input: {
    gitConfig?: GitConfig;
    paths: AttributionPaths;
    platform?: NodeJS.Platform;
    readIdentity?: () => ProcessIdentity | undefined;
}): DoctorResult;
export declare function readInstallState(path: string): InstallState | undefined;
export {};
//# sourceMappingURL=installer.d.ts.map