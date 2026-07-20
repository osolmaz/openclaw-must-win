import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CO_AUTHOR_TRAILER = "Co-Authored-By";
const GENERATED_BY_TRAILER = "Generated-By";
const FALLBACK_VALUE = "unknown";

export type CommitTrailers = {
  coAuthor: string;
  generatedBy: string;
};

export function buildCommitTrailers(model: string, openClawVersion: string): CommitTrailers {
  const safeModel = sanitizeTrailerValue(model);
  const safeVersion = sanitizeTrailerValue(openClawVersion);

  return {
    coAuthor: `${CO_AUTHOR_TRAILER}: ${safeModel} via OpenClaw <noreply@openclaw.ai>`,
    generatedBy: `${GENERATED_BY_TRAILER}: OpenClaw ${safeVersion}`,
  };
}

export function createCommitHookDirectory(): string {
  const hooksDirectory = mkdtempSync(join(tmpdir(), "openclaw-must-win-hooks-"));
  const hookPath = join(hooksDirectory, "prepare-commit-msg");
  writeFileSync(hookPath, buildPrepareCommitMessageHook());
  chmodSync(hookPath, 0o755);
  return hooksDirectory;
}

export function removeCommitHookDirectory(hooksDirectory: string | undefined): void {
  if (hooksDirectory === undefined) {
    return;
  }
  rmSync(hooksDirectory, { force: true, recursive: true });
}

export function wrapExecCommand(
  command: string,
  hooksDirectory: string,
  model: string,
  openClawVersion: string,
): string {
  const trailers = buildCommitTrailers(model, openClawVersion);
  return `${buildEnvironmentPrefix(hooksDirectory, trailers)}\n${command}`;
}

function sanitizeTrailerValue(value: string): string {
  const sanitized = value
    .replaceAll("\u0000", " ")
    .replace(/[<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || FALLBACK_VALUE;
}

function buildEnvironmentPrefix(hooksDirectory: string, trailers: CommitTrailers): string {
  return `__openclaw_must_win_git_config_index="\${GIT_CONFIG_COUNT:-0}"
export OPENCLAW_MUST_WIN_GIT_CONFIG_INDEX="$__openclaw_must_win_git_config_index"
export OPENCLAW_MUST_WIN_CO_AUTHOR=${shellQuote(trailers.coAuthor)}
export OPENCLAW_MUST_WIN_GENERATED_BY=${shellQuote(trailers.generatedBy)}
export "GIT_CONFIG_KEY_\${__openclaw_must_win_git_config_index}=core.hooksPath"
export "GIT_CONFIG_VALUE_\${__openclaw_must_win_git_config_index}=${escapeDoubleQuotedAssignmentValue(hooksDirectory)}"
export GIT_CONFIG_COUNT="$((__openclaw_must_win_git_config_index + 1))"
unset __openclaw_must_win_git_config_index`;
}

function buildPrepareCommitMessageHook(): string {
  return `#!/bin/sh
set -eu

message_file="$1"

git \\
  -c trailer.co-authored-by.ifExists=addIfDifferent \\
  -c trailer.generated-by.ifExists=replace \\
  interpret-trailers \\
  --in-place \\
  --trailer "$OPENCLAW_MUST_WIN_CO_AUTHOR" \\
  --trailer "$OPENCLAW_MUST_WIN_GENERATED_BY" \\
  "$message_file"

__openclaw_config_index="$OPENCLAW_MUST_WIN_GIT_CONFIG_INDEX"
unset "GIT_CONFIG_KEY_$__openclaw_config_index"
unset "GIT_CONFIG_VALUE_$__openclaw_config_index"
export GIT_CONFIG_COUNT="$__openclaw_config_index"

original_hook="$(git rev-parse --git-path hooks/prepare-commit-msg)"
if [ -x "$original_hook" ] && [ "$original_hook" != "$0" ]; then
  "$original_hook" "$@"
fi
`;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function escapeDoubleQuotedAssignmentValue(value: string): string {
  return value.replace(/[\\"$`]/g, "\\$&");
}
