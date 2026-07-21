import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCommitTrailers, buildCommitTrailers } from "../src/commit-trailers.js";

const MODEL = "openai/gpt-5.6-sol";
const VERSION = "2026.6.11";

function withMessage(run: (path: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "openclaw-must-win-message-"));
  const path = join(directory, "COMMIT_EDITMSG");
  writeFileSync(path, "subject\n");
  try {
    run(path);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe("commit trailers", () => {
  it("builds sanitized attribution trailers", () => {
    expect(buildCommitTrailers(MODEL, VERSION)).toEqual({
      coAuthor: "Co-Authored-By: openai/gpt-5.6-sol via OpenClaw <noreply@openclaw.ai>",
      generatedBy: "Generated-By: OpenClaw 2026.6.11",
    });
    expect(buildCommitTrailers("Bad\n<Model>", "\n")).toEqual({
      coAuthor: "Co-Authored-By: Bad Model via OpenClaw <noreply@openclaw.ai>",
      generatedBy: "Generated-By: OpenClaw unknown",
    });
    expect(buildCommitTrailers("Bad\u0000Model", "1").coAuthor).toContain("Bad Model");
  });

  it("adds trailers once and replaces the generated-by value", () => {
    withMessage((path) => {
      applyCommitTrailers(path, MODEL, VERSION);
      applyCommitTrailers(path, MODEL, "2026.7.1");
      const message = readFileSync(path, "utf8");

      expect(message.match(/Co-Authored-By:/gu)).toHaveLength(1);
      expect(message).toContain("Generated-By: OpenClaw 2026.7.1");
      expect(message).not.toContain("Generated-By: OpenClaw 2026.6.11");
    });
  });

  it("reports Git failures", () => {
    withMessage((path) => {
      expect(() => {
        applyCommitTrailers(path, MODEL, VERSION, "/missing/git");
      }).toThrow("ENOENT");
      expect(() => {
        applyCommitTrailers(path, MODEL, VERSION, "false");
      }).toThrow("git interpret-trailers exited 1");

      const failingGit = join(path, "..", "failing-git");
      writeFileSync(failingGit, "#!/bin/sh\nprintf '  rejected  \\n' >&2\nexit 2\n", {
        mode: 0o755,
      });
      try {
        applyCommitTrailers(path, MODEL, VERSION, failingGit);
        throw new Error("expected failing Git command");
      } catch (error) {
        expect(error).toEqual(new Error("rejected"));
      }
    });
  });

  it("produces a commit message Git accepts", () => {
    withMessage((path) => {
      applyCommitTrailers(path, MODEL, VERSION);
      const output = execFileSync("git", ["interpret-trailers", "--parse", path], {
        encoding: "utf8",
      });
      expect(output).toContain("Co-Authored-By: openai/gpt-5.6-sol via OpenClaw");
      expect(output).toContain("Generated-By: OpenClaw 2026.6.11");
    });
  });
});
