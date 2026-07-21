import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe("package CLI", () => {
  it("runs when Node receives an npm-style bin symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "openclaw-must-win-cli-"));
    roots.push(root);
    const binPath = join(root, "openclaw-must-win");
    symlinkSync(join(process.cwd(), "dist", "cli.js"), binPath);

    const output = execFileSync(process.execPath, [binPath, "--help"], { encoding: "utf8" });

    expect(output).toContain("Usage: openclaw-must-win <command>");
  });
});
