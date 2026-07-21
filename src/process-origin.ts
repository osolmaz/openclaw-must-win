import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";

export const EXECUTION_ID_ENV = "OPENCLAW_MUST_WIN_EXECUTION_ID";

const EXECUTION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const POSIX_SHELLS = new Set(["ash", "bash", "dash", "fish", "ksh", "sh", "zsh"]);

export type ProcessIdentity = {
  bootId: string;
  cgroup: string;
};

export type ProcessSnapshot = {
  commandHashes: ReadonlySet<string>;
  executionIds: ReadonlySet<string>;
  identity: ProcessIdentity;
};

export function hashCommand(command: string): string {
  return createHash("sha256").update(command).digest("hex");
}

export function readProcessIdentity(
  pid = process.pid,
  readFile: typeof readFileSync = readFileSync,
): ProcessIdentity | undefined {
  try {
    const bootId = readFile("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const cgroup = normalizeCgroup(readFile(`/proc/${String(pid)}/cgroup`, "utf8"));
    if (!bootId || !cgroup) {
      return undefined;
    }
    return { bootId, cgroup };
  } catch {
    return undefined;
  }
}

export function readProcessSnapshot(
  pid = process.pid,
  readFile: typeof readFileSync = readFileSync,
): ProcessSnapshot | undefined {
  const identity = readProcessIdentity(pid, readFile);
  if (identity === undefined) {
    return undefined;
  }

  const evidence = collectProcessEvidence(pid, readFile);
  return { ...evidence, identity };
}

function collectProcessEvidence(pid: number, readFile: typeof readFileSync) {
  const commandHashes = new Set<string>();
  const executionIds = new Set<string>();
  const visited = new Set<number>();
  let currentPid = pid;
  for (let depth = 0; depth < 64; depth += 1) {
    if (currentPid <= 1 || visited.has(currentPid)) {
      break;
    }
    visited.add(currentPid);
    try {
      const argv = readProcessArguments(currentPid, readFile);
      if (argv.length > 0) {
        commandHashes.add(hashCommand(argv.join(" ")));
      }
      const shellPayload = readShellCommandPayload(argv);
      if (shellPayload !== undefined) {
        commandHashes.add(hashCommand(shellPayload));
      }
      const executionId = readExecutionId(currentPid, readFile);
      if (executionId !== undefined) {
        executionIds.add(executionId);
      }
      currentPid = readParentPid(readFile(`/proc/${String(currentPid)}/stat`, "utf8"));
    } catch {
      break;
    }
  }
  return { commandHashes, executionIds };
}

function readProcessArguments(pid: number, readFile: typeof readFileSync): string[] {
  return readFile(`/proc/${String(pid)}/cmdline`)
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

function readShellCommandPayload(argv: string[]): string | undefined {
  if (argv.length < 3 || !POSIX_SHELLS.has(basename(argv[0] ?? ""))) {
    return undefined;
  }
  const commandFlagIndex = argv.findIndex(
    (argument, index) => index > 0 && /^-[^-]*c[^-]*$/u.test(argument),
  );
  const payload = commandFlagIndex < 0 ? undefined : argv[commandFlagIndex + 1];
  return payload?.trim() ? payload : undefined;
}

function readExecutionId(pid: number, readFile: typeof readFileSync): string | undefined {
  try {
    const prefix = `${EXECUTION_ID_ENV}=`;
    const entry = readFile(`/proc/${String(pid)}/environ`)
      .toString("utf8")
      .split("\0")
      .find((value) => value.startsWith(prefix));
    const value = entry?.slice(prefix.length);
    return value && EXECUTION_ID_PATTERN.test(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function normalizeCgroup(raw: string): string {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort()
    .join("\n");
}

function readParentPid(stat: string): number {
  const commandEnd = stat.lastIndexOf(")");
  if (commandEnd < 0) {
    return 0;
  }
  const fields = stat
    .slice(commandEnd + 1)
    .trim()
    .split(/\s+/);
  const parentPid = Number(fields[1]);
  return Number.isSafeInteger(parentPid) && parentPid > 0 ? parentPid : 0;
}
