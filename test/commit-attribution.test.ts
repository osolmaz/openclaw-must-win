import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CommitAttribution } from "../src/commit-attribution.js";

function extractHookDirectory(command: string): string {
  const match = /\/tmp\/openclaw-must-win-hooks-[^"\n]+/.exec(command);
  if (match === null) {
    throw new Error("wrapped command did not contain a hook directory");
  }
  return match[0];
}

describe("CommitAttribution", () => {
  it("reuses its hook directory until stopped", () => {
    const commits = new CommitAttribution();
    const first = extractHookDirectory(commits.wrap("true", "model", "1"));
    const second = extractHookDirectory(commits.wrap("true", "model", "1"));

    expect(second).toBe(first);
    expect(existsSync(first)).toBe(true);

    commits.stop();
    expect(existsSync(first)).toBe(false);
    expect(() => {
      commits.stop();
    }).not.toThrow();

    const replacement = extractHookDirectory(commits.wrap("true", "model", "1"));
    expect(replacement).not.toBe(first);
    commits.stop();
  });
});
