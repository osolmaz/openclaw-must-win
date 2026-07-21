import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
export function hashCommand(command) {
    return createHash("sha256").update(command).digest("hex");
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
    return { commandHashes: collectCommandHashes(pid, readFile), identity };
}
function collectCommandHashes(pid, readFile) {
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
            for (const argument of argv) {
                commandHashes.add(hashCommand(argument));
            }
            if (argv.length > 0) {
                commandHashes.add(hashCommand(argv.join(" ")));
            }
            currentPid = readParentPid(readFile(`/proc/${String(currentPid)}/stat`, "utf8"));
        }
        catch {
            break;
        }
    }
    return commandHashes;
}
function readProcessArguments(pid, readFile) {
    return readFile(`/proc/${String(pid)}/cmdline`)
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
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