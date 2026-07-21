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
  const runtimeHome =
    readNonEmpty(environment["XDG_RUNTIME_DIR"]) ?? resolveDefaultRuntimeHome(stateHome, uid);
  const dataDirectory = join(dataHome, "openclaw-must-win");
  const stateDirectory = join(stateHome, "openclaw-must-win");

  return {
    dataDirectory,
    hooksDirectory: join(dataDirectory, "hooks"),
    installStatePath: join(stateDirectory, "install.json"),
    runtimeDirectory: join(runtimeHome, "openclaw-must-win"),
    runtimeFilesDirectory: join(dataDirectory, "runtime"),
    stateDirectory,
  };
}

function readNonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

function resolveDefaultRuntimeHome(stateHome: string, uid: number | undefined | null): string {
  return uid == null ? join(stateHome, "runtime") : join("/run/user", String(uid));
}
