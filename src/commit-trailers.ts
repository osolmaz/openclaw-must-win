import { spawnSync } from "node:child_process";

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

export function applyCommitTrailers(
  messageFile: string,
  model: string,
  openClawVersion: string,
  gitExecutable = "git",
): void {
  const trailers = buildCommitTrailers(model, openClawVersion);
  const result = spawnSync(
    gitExecutable,
    [
      "-c",
      "trailer.co-authored-by.ifExists=addIfDifferent",
      "-c",
      "trailer.generated-by.ifExists=replace",
      "interpret-trailers",
      "--in-place",
      "--trailer",
      trailers.coAuthor,
      "--trailer",
      trailers.generatedBy,
      messageFile,
    ],
    { encoding: "utf8" },
  );
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      result.stderr.trim() || `git interpret-trailers exited ${String(result.status)}`,
    );
  }
}

function sanitizeTrailerValue(value: string): string {
  const sanitized = value
    .replaceAll("\u0000", " ")
    .replace(/[<>\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return sanitized || FALLBACK_VALUE;
}
