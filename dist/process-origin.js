import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const POSIX_SHELLS = new Set(["ash", "bash", "dash", "fish", "ksh", "sh", "zsh"]);
export function hashCommand(command) {
    return createHash("sha256").update(normalizeCommandFingerprint(command)).digest("hex");
}
const SHELL_SYNTAX_PATTERN = /\\(.)|'([^']*)'|"((?:\\.|[^"])*)"|(\s+)/gsu;
function normalizeCommandFingerprint(command) {
    return command.trim().replace(SHELL_SYNTAX_PATTERN, replaceShellSyntax).replace(/\s+/gu, " ");
}
function replaceShellSyntax(match, escaped, singleQuoted, doubleQuoted, whitespace) {
    if (whitespace !== undefined) {
        return " ";
    }
    if (escaped !== undefined) {
        return escaped;
    }
    if (singleQuoted !== undefined) {
        return singleQuoted;
    }
    return doubleQuoted?.replace(/\\(.)/gsu, "$1") ?? match;
}
export function readProcessIdentity(pid = process.pid, readFile = readFileSync) {
    try {
        const bootId = readFile("/proc/sys/kernel/random/boot_id", "utf8").trim();
        const cgroup = normalizeCgroup(readFile(`/proc/${String(pid)}/cgroup`, "utf8"));
        if (!bootId || !cgroup) {
            return undefined;
        }
        return { bootId, cgroup };
    }
    catch {
        return undefined;
    }
}
export function readProcessSnapshot(pid = process.pid, readFile = readFileSync) {
    const identity = readProcessIdentity(pid, readFile);
    if (identity === undefined) {
        return undefined;
    }
    const evidence = collectProcessEvidence(pid, readFile);
    return { ...evidence, identity };
}
function collectProcessEvidence(pid, readFile) {
    const commandHashes = new Set();
    const visited = new Set();
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
            for (const payload of readProcessPayloads(argv)) {
                commandHashes.add(hashCommand(payload));
            }
            currentPid = readParentPid(readFile(`/proc/${String(currentPid)}/stat`, "utf8"));
        }
        catch {
            break;
        }
    }
    return { commandHashes };
}
function readProcessArguments(pid, readFile) {
    return readFile(`/proc/${String(pid)}/cmdline`)
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
}
function readProcessPayloads(argv) {
    if (argv.length < 2 || !POSIX_SHELLS.has(basename(argv[0] ?? ""))) {
        return [];
    }
    const payload = readShellCommand(argv) ?? readInterpreterScript(argv);
    return payload === undefined ? [] : [payload];
}
function readShellCommand(argv) {
    const commandFlagIndex = argv.findIndex((argument, index) => index > 0 && /^-[^-]*c[^-]*$/u.test(argument));
    const command = commandFlagIndex < 0 ? undefined : argv[commandFlagIndex + 1];
    return command?.trim() ? command : undefined;
}
function readInterpreterScript(argv) {
    const script = argv.find((argument, index) => index > 0 && !argument.startsWith("-"));
    return script?.trim() ? script : undefined;
}
function normalizeCgroup(raw) {
    return raw
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .sort()
        .join("\n");
}
function readParentPid(stat) {
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
//# sourceMappingURL=process-origin.js.map