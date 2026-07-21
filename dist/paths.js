import { homedir } from "node:os";
import { join } from "node:path";
export function resolveAttributionPaths(environment = process.env, homeDirectory = homedir(), uid = typeof process.getuid === "function"
    ? process.getuid()
    : undefined) {
    const dataHome = readNonEmpty(environment["XDG_DATA_HOME"]) ?? join(homeDirectory, ".local", "share");
    const stateHome = readNonEmpty(environment["XDG_STATE_HOME"]) ?? join(homeDirectory, ".local", "state");
    const runtimeHome = resolveDefaultRuntimeHome(stateHome, uid);
    const dataDirectory = resolvePinnedDirectory(environment, "OPENCLAW_MUST_WIN_DATA_DIRECTORY", join(dataHome, "openclaw-must-win"));
    const stateDirectory = resolvePinnedDirectory(environment, "OPENCLAW_MUST_WIN_STATE_DIRECTORY", join(stateHome, "openclaw-must-win"));
    const runtimeDirectory = resolvePinnedDirectory(environment, "OPENCLAW_MUST_WIN_RUNTIME_DIRECTORY", join(runtimeHome, "openclaw-must-win"));
    return {
        dataDirectory,
        hooksDirectory: join(dataDirectory, "hooks"),
        installStatePath: join(stateDirectory, "install.json"),
        runtimeDirectory,
        runtimeFilesDirectory: join(dataDirectory, "runtime"),
        stateDirectory,
    };
}
function resolvePinnedDirectory(environment, key, fallback) {
    return readNonEmpty(environment[key]) ?? fallback;
}
function readNonEmpty(value) {
    const trimmed = value?.trim();
    return trimmed === "" ? undefined : trimmed;
}
function resolveDefaultRuntimeHome(stateHome, uid) {
    return uid == null ? join(stateHome, "runtime") : join("/run/user", String(uid));
}
//# sourceMappingURL=paths.js.map