import { existsSync, unlinkSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CommitAttribution } from "../src/commit-attribution.js";
import { removeCommitHookDirectory } from "../src/commit-trailers.js";

function extractHookDirectory(command: string): string {
  const match = /\/tmp\/openclaw-must-win-hooks-[^'"\s]+/.exec(command);
  if (match === null) {
    throw new Error("wrapped command did not contain a hook directory");
  }
  return match[0];
}

describe("CommitAttribution", () => {
  it("reuses its hook directory for delayed commands", () => {
    const commits = new CommitAttribution();
    const first = extractHookDirectory(commits.wrap("git commit -m test", "model", "1"));
    const second = extractHookDirectory(commits.wrap("git commit -m test", "model", "1"));

    expect(second).toBe(first);
    expect(existsSync(first)).toBe(true);

    unlinkSync(`${first}/prepare-commit-msg`);
    expect(existsSync(first)).toBe(true);

    const replacement = extractHookDirectory(
      commits.wrap("git commit -m replacement", "model", "1"),
    );
    expect(replacement).not.toBe(first);
    expect(existsSync(replacement)).toBe(true);
    removeCommitHookDirectory(first);
    removeCommitHookDirectory(replacement);
  });
});
