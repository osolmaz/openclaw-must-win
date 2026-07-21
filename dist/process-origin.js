import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
const POSIX_SHELLS = new Set(["ash", "bash", "dash", "fish", "ksh", "sh", "zsh"]);
export function hashCommand(command) {
    return createHash("sha256").update(normalizeCommandFingerprint(command)).digest("hex");
}
export function hashCommandVariants(command) {
    const hashes = new Set([hashCommand(command)]);
    if (hasDynamicShellSyntax(command)) {
        return hashes;
    }
    collectCommandVariantHashes(command, hashes, 0);
    return hashes;
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
function hasDynamicShellSyntax(command) {
    return command.includes("<<") || command.includes("$(") || command.includes("`");
}
function collectCommandVariantHashes(command, hashes, depth) {
    if (depth >= 4 || hashes.size >= 64) {
        return;
    }
    for (const words of parseSimpleCommands(command)) {
        const normalizedWords = normalizeSimpleCommand(words);
        if (normalizedWords.length > 0) {
            hashes.add(hashCommand(normalizedWords.join(" ")));
        }
        const nestedCommand = readNestedShellCommand(words);
        if (nestedCommand !== undefined && !hasDynamicShellSyntax(nestedCommand)) {
            collectCommandVariantHashes(nestedCommand, hashes, depth + 1);
        }
    }
}
function parseSimpleCommands(command) {
    const state = {
        commands: [],
        escaped: false,
        quote: undefined,
        word: "",
        words: [],
    };
    for (const character of command) {
        if (consumeShellEscape(state, character) || consumeShellQuote(state, character)) {
            continue;
        }
        if (state.quote === undefined && /[;&|()\n]/u.test(character)) {
            finishParsedCommand(state);
        }
        else if (state.quote === undefined && /\s/u.test(character)) {
            finishParsedWord(state);
        }
        else {
            state.word += character;
        }
    }
    finishParsedCommand(state);
    return state.commands;
}
function consumeShellEscape(state, character) {
    if (state.escaped) {
        state.word += character;
        state.escaped = false;
        return true;
    }
    if (character === "\\" && state.quote !== "single") {
        state.escaped = true;
        return true;
    }
    return false;
}
function consumeShellQuote(state, character) {
    if (character === "'" && state.quote !== "double") {
        state.quote = state.quote === "single" ? undefined : "single";
        return true;
    }
    if (character === '"' && state.quote !== "single") {
        state.quote = state.quote === "double" ? undefined : "double";
        return true;
    }
    return false;
}
function finishParsedWord(state) {
    if (state.word) {
        state.words.push(state.word);
        state.word = "";
    }
}
function finishParsedCommand(state) {
    finishParsedWord(state);
    if (state.words.length > 0) {
        state.commands.push(state.words);
        state.words = [];
    }
}
function normalizeSimpleCommand(words) {
    const firstCommandIndex = words.findIndex((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word));
    if (firstCommandIndex < 0) {
        return [];
    }
    const commandIndex = words[firstCommandIndex] === "exec" || words[firstCommandIndex] === "command"
        ? firstCommandIndex + 1
        : firstCommandIndex;
    return words.slice(commandIndex);
}
function readNestedShellCommand(words) {
    const executable = basename(words[0] ?? "");
    if (!POSIX_SHELLS.has(executable)) {
        return undefined;
    }
    const commandFlagIndex = words.findIndex((argument, index) => index > 0 && /^-[^-]*c[^-]*$/u.test(argument));
    return commandFlagIndex < 0 ? undefined : words[commandFlagIndex + 1];
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
                addHashes(commandHashes, hashCommandVariants(payload));
            }
            currentPid = readParentPid(readFile(`/proc/${String(currentPid)}/stat`, "utf8"));
        }
        catch {
            break;
        }
    }
    return { commandHashes };
}
function addHashes(target, hashes) {
    for (const hash of hashes) {
        target.add(hash);
    }
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