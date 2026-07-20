import { existsSync, unlinkSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
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
  it("does not create hooks for unrelated commands or propagate setup failures", () => {
    const createHooks = vi.fn(() => {
      throw new Error("temporary directory unavailable");
    });
    const commits = new CommitAttribution(createHooks, "linux");

    expect(commits.wrap("pwd", "model", "1")).toBe("pwd");
    expect(createHooks).not.toHaveBeenCalled();
    expect(commits.wrap("git commit -m test", "model", "1")).toBe("git commit -m test");
    expect(createHooks).toHaveBeenCalledOnce();
  });

  it("does not create hooks on Windows", () => {
    const createHooks = vi.fn(() => "unused");
    const commits = new CommitAttribution(createHooks, "win32");

    expect(commits.wrap("git commit -m test", "model", "1")).toBe("git commit -m test");
    expect(createHooks).not.toHaveBeenCalled();
  });

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
