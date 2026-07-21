import { homedir } from "node:os";
import { join } from "node:path";

export type AttributionPaths = {
  dataDirectory: string;
  hooksDirectory: string;
  installStatePath: string;
  runtimeDirectory: string;
  runtimeFilesDirectory: string;
  stateDirectory: string;
};

export function resolveAttributionPaths(
  environment: NodeJS.ProcessEnv = process.env,
  homeDirectory = homedir(),
  uid: number | undefined | null = typeof process.getuid === "function"
    ? process.getuid()
    : undefined,
): AttributionPaths {
  const dataHome =
    readNonEmpty(environment["XDG_DATA_HOME"]) ?? join(homeDirectory, ".local", "share");
  const stateHome =
    readNonEmpty(environment["XDG_STATE_HOME"]) ?? join(homeDirectory, ".local", "state");
  const runtimeHome = resolveDefaultRuntimeHome(stateHome, uid);
  const dataDirectory = resolvePinnedDirectory(
    environment,
    "OPENCLAW_MUST_WIN_DATA_DIRECTORY",
    join(dataHome, "openclaw-must-win"),
  );
  const stateDirectory = resolvePinnedDirectory(
    environment,
    "OPENCLAW_MUST_WIN_STATE_DIRECTORY",
    join(stateHome, "openclaw-must-win"),
  );
  const runtimeDirectory = resolvePinnedDirectory(
    environment,
    "OPENCLAW_MUST_WIN_RUNTIME_DIRECTORY",
    join(runtimeHome, "openclaw-must-win"),
  );

  return {
    dataDirectory,
    hooksDirectory: join(dataDirectory, "hooks"),
    installStatePath: join(stateDirectory, "install.json"),
    runtimeDirectory,
    runtimeFilesDirectory: join(dataDirectory, "runtime"),
    stateDirectory,
  };
}

function resolvePinnedDirectory(
  environment: NodeJS.ProcessEnv,
  key:
    | "OPENCLAW_MUST_WIN_DATA_DIRECTORY"
    | "OPENCLAW_MUST_WIN_RUNTIME_DIRECTORY"
    | "OPENCLAW_MUST_WIN_STATE_DIRECTORY",
  fallback: string,
): string {
  return readNonEmpty(environment[key]) ?? fallback;
}

function readNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function resolveDefaultRuntimeHome(stateHome: string, uid: number | undefined | null): string {
  return uid == null ? join(stateHome, "runtime") : join("/run/user", String(uid));
}
