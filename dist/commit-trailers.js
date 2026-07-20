import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prefixGitCommitCommands } from "./git-commit-command.js";
const CO_AUTHOR_TRAILER = "Co-Authored-By";
const GENERATED_BY_TRAILER = "Generated-By";
const FALLBACK_VALUE = "unknown";
const GIT_HOOK_NAMES = [
    "applypatch-msg",
    "commit-msg",
    "fsmonitor-watchman",
    "post-applypatch",
    "post-checkout",
    "post-commit",
    "post-index-change",
    "post-merge",
    "post-receive",
    "post-rewrite",
    "post-update",
    "pre-applypatch",
    "pre-auto-gc",
    "pre-commit",
    "pre-merge-commit",
    "pre-push",
    "pre-rebase",
    "pre-receive",
    "prepare-commit-msg",
    "proc-receive",
    "push-to-checkout",
    "reference-transaction",
    "sendemail-validate",
    "update",
];
export function buildCommitTrailers(model, openClawVersion) {
    const safeModel = sanitizeTrailerValue(model);
    const safeVersion = sanitizeTrailerValue(openClawVersion);
    return {
        coAuthor: `${CO_AUTHOR_TRAILER}: ${safeModel} via OpenClaw <noreply@openclaw.ai>`,
        generatedBy: `${GENERATED_BY_TRAILER}: OpenClaw ${safeVersion}`,
    };
}
export function createCommitHookDirectory() {
    const hooksDirectory = mkdtempSync(join(tmpdir(), "openclaw-must-win-hooks-"));
    const hook = buildGitHook();
    for (const hookName of GIT_HOOK_NAMES) {
        const hookPath = join(hooksDirectory, hookName);
        writeFileSync(hookPath, hook);
        chmodSync(hookPath, 0o755);
    }
    return hooksDirectory;
}
export function removeCommitHookDirectory(hooksDirectory) {
    if (hooksDirectory === undefined) {
        return;
    }
    rmSync(hooksDirectory, { force: true, recursive: true });
}
export function wrapExecCommand(command, hooksDirectory, model, openClawVersion, environment = process.env) {
    const configIndex = readGitConfigCount(environment);
    if (configIndex === undefined) {
        return command;
    }
    const trailers = buildCommitTrailers(model, openClawVersion);
    const prefix = buildEnvironmentPrefix(hooksDirectory, trailers, configIndex);
    return prefixGitCommitCommands(command, prefix);
}
function sanitizeTrailerValue(value) {
    const sanitized = value
        .replaceAll("\u0000", " ")
        .replace(/[<>\r\n]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return sanitized || FALLBACK_VALUE;
}
function buildEnvironmentPrefix(hooksDirectory, trailers, configIndex) {
    const assignments = [
        ["OPENCLAW_MUST_WIN_GIT_CONFIG_INDEX", String(configIndex)],
        ["OPENCLAW_MUST_WIN_CO_AUTHOR", trailers.coAuthor],
        ["OPENCLAW_MUST_WIN_GENERATED_BY", trailers.generatedBy],
        [`GIT_CONFIG_KEY_${String(configIndex)}`, "core.hooksPath"],
        [`GIT_CONFIG_VALUE_${String(configIndex)}`, hooksDirectory],
        ["GIT_CONFIG_COUNT", String(configIndex + 1)],
    ];
    return `${assignments.map(([name, value]) => `${name}=${shellQuote(value)}`).join(" ")} `;
}
function readGitConfigCount(environment) {
    const rawCount = environment["GIT_CONFIG_COUNT"];
    if (rawCount === undefined) {
        return 0;
    }
    if (!/^\d+$/.test(rawCount)) {
        return undefined;
    }
    const count = Number(rawCount);
    return Number.isSafeInteger(count) ? count : undefined;
}
function buildGitHook() {
    return `#!/bin/sh
set -eu

hook_name="\${0##*/}"
if [ "$hook_name" = "prepare-commit-msg" ]; then
  message_file="$1"
  git \\
    -c trailer.co-authored-by.ifExists=addIfDifferent \\
    -c trailer.generated-by.ifExists=replace \\
    interpret-trailers \\
    --in-place \\
    --trailer "$OPENCLAW_MUST_WIN_CO_AUTHOR" \\
    --trailer "$OPENCLAW_MUST_WIN_GENERATED_BY" \\
    "$message_file"
fi

__openclaw_config_index="$OPENCLAW_MUST_WIN_GIT_CONFIG_INDEX"
unset "GIT_CONFIG_KEY_$__openclaw_config_index"
unset "GIT_CONFIG_VALUE_$__openclaw_config_index"
export GIT_CONFIG_COUNT="$__openclaw_config_index"

original_hook="$(git rev-parse --git-path "hooks/$hook_name")"
if [ -x "$original_hook" ] && [ "$original_hook" != "$0" ]; then
  exec "$original_hook" "$@"
fi
`;
}
function shellQuote(value) {
    return `'${value.replaceAll("'", `'\\''`)}'`;
}
//# sourceMappingURL=commit-trailers.js.map