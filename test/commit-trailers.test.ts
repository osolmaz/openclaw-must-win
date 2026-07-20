import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildCommitTrailers,
  createCommitHookDirectory,
  removeCommitHookDirectory,
  wrapExecCommand,
} from "../src/commit-trailers.js";

const MODEL = "gpt-5.6-sol";
const OTHER_MODEL = "claude-sonnet-5";
const OPENCLAW_VERSION = "2026.6.11";
const CO_AUTHOR = `Co-Authored-By: ${MODEL} via OpenClaw <noreply@openclaw.ai>`;
const GENERATED_BY = `Generated-By: OpenClaw ${OPENCLAW_VERSION}`;

type GitRepo = {
  cleanup: () => void;
  cwd: string;
  hooksDirectory: string;
  run: (script: string, model?: string, env?: NodeJS.ProcessEnv) => string;
};

function createIsolatedEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (
      key.startsWith("OPENCLAW_MUST_WIN_") ||
      /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/.test(key)
    ) {
      Reflect.deleteProperty(environment, key);
    }
  }
  return environment;
}

function createGitRepo(): GitRepo {
  const cwd = mkdtempSync(join(tmpdir(), "openclaw-must-win-test-"));
  const hooksDirectory = createCommitHookDirectory();
  execFileSync(
    "bash",
    [
      "-lc",
      "set -euo pipefail\ngit init -q\ngit config user.name Tester\ngit config user.email tester@example.com",
    ],
    { cwd, env: createIsolatedEnvironment(), stdio: ["ignore", "pipe", "pipe"] },
  );

  const repo: GitRepo = {
    cwd,
    hooksDirectory,
    run(script, model = MODEL, env = createIsolatedEnvironment()) {
      const wrapped = wrapExecCommand(script, repo.hooksDirectory, model, OPENCLAW_VERSION);
      return execFileSync("bash", ["-lc", `set -euo pipefail\n${wrapped}`], {
        cwd,
        encoding: "utf8",
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
    },
    cleanup() {
      removeCommitHookDirectory(repo.hooksDirectory);
      rmSync(cwd, { force: true, recursive: true });
    },
  };
  return repo;
}

function withGitRepo<T>(run: (repo: GitRepo) => T): T {
  const repo = createGitRepo();
  try {
    return run(repo);
  } finally {
    repo.cleanup();
  }
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe("Git commit trailers", () => {
  it("adds attribution without changing repository configuration", () => {
    withGitRepo((repo) => {
      const output = repo.run(`
echo one > a.txt
git add a.txt
git commit -q -m 'simple subject'
git config --local --get core.hooksPath || true
test ! -f .git/hooks/prepare-commit-msg
git log -1 --format=%B
`);

      expect(output).toContain("simple subject");
      expect(output).toContain(CO_AUTHOR);
      expect(output).toContain(GENERATED_BY);
      expect(existsSync(join(repo.cwd, ".git/hooks/prepare-commit-msg"))).toBe(false);
    });
  });

  it("attributes nested and amended commits without duplicate trailers", () => {
    withGitRepo((repo) => {
      const output = repo.run(`
echo one > a.txt
git add a.txt
sh -c 'git commit -q -m "nested subject"'
echo two >> a.txt
git add a.txt
git commit -q --amend --no-edit
git log -1 --format=%B
`);

      expect(output).toContain("nested subject");
      expect(countOccurrences(output, CO_AUTHOR)).toBe(1);
      expect(countOccurrences(output, GENERATED_BY)).toBe(1);
    });
  });

  it("preserves the active model when a commit is amended by another model", () => {
    withGitRepo((repo) => {
      repo.run("echo one > a; git add a; git commit -q -m first");
      const output = repo.run(
        "echo two >> a; git add a; git commit -q --amend --no-edit; git log -1 --format=%B",
        OTHER_MODEL,
      );

      expect(output).toContain(CO_AUTHOR);
      expect(output).toContain(`Co-Authored-By: ${OTHER_MODEL} via OpenClaw <noreply@openclaw.ai>`);
      expect(countOccurrences(output, GENERATED_BY)).toBe(1);
    });
  });

  it("chains default and configured repository hooks", () => {
    withGitRepo((repo) => {
      const defaultHook = join(repo.cwd, ".git/hooks/prepare-commit-msg");
      writeFileSync(defaultHook, '#!/bin/sh\nprintf "\\nUser-Hook: default\\n" >> "$1"\n', {
        mode: 0o755,
      });
      const defaultOutput = repo.run(
        "echo one > a; git add a; git commit -q -m default; git log -1 --format=%B",
      );
      expect(defaultOutput).toContain("User-Hook: default");

      const customHooks = join(repo.cwd, "custom-hooks");
      mkdirSync(customHooks);
      writeFileSync(
        join(customHooks, "prepare-commit-msg"),
        '#!/bin/sh\nprintf "\\nUser-Hook: custom\\n" >> "$1"\n',
        { mode: 0o755 },
      );
      const customOutput = repo.run(
        "git config core.hooksPath custom-hooks; echo two > b; git add b; git commit -q -m custom; git log -1 --format=%B",
      );
      expect(customOutput).toContain("User-Hook: custom");
      expect(customOutput).toContain(CO_AUTHOR);
    });
  });

  it("propagates an existing hook failure", () => {
    withGitRepo((repo) => {
      writeFileSync(join(repo.cwd, ".git/hooks/prepare-commit-msg"), "#!/bin/sh\nexit 42\n", {
        mode: 0o755,
      });

      expect(() => repo.run("echo one > a; git add a; git commit -q -m blocked")).toThrow();
    });
  });

  it("preserves existing process-local Git configuration", () => {
    withGitRepo((repo) => {
      const environment = createIsolatedEnvironment();
      environment["GIT_CONFIG_COUNT"] = "1";
      environment["GIT_CONFIG_KEY_0"] = "commit.cleanup";
      environment["GIT_CONFIG_VALUE_0"] = "strip";
      const output = repo.run(
        "echo one > a; git add a; git commit -q -m configured; git config --get commit.cleanup; git log -1 --format=%B",
        MODEL,
        environment,
      );

      expect(output).toContain("strip");
      expect(output).toContain(CO_AUTHOR);
    });
  });

  it("quotes unusual hook paths and trailer values", () => {
    withGitRepo((repo) => {
      const unusualDirectory = `${repo.hooksDirectory}-'\\"$\``;
      renameSync(repo.hooksDirectory, unusualDirectory);
      repo.hooksDirectory = unusualDirectory;

      const output = repo.run(
        "echo one > a; git add a; git commit -q -m quoted; git log -1 --format=%B",
        "Model O'Clock\n<unsafe>",
      );
      expect(output).toContain(
        "Co-Authored-By: Model O'Clock unsafe via OpenClaw <noreply@openclaw.ai>",
      );
    });
  });

  it("sanitizes empty and unsafe trailer values", () => {
    expect(buildCommitTrailers("Bad\n<Model>", "\n")).toEqual({
      coAuthor: "Co-Authored-By: Bad Model via OpenClaw <noreply@openclaw.ai>",
      generatedBy: "Generated-By: OpenClaw unknown",
    });
    expect(buildCommitTrailers("Bad\u0000Model", "1").coAuthor).toContain("Bad Model");
    expect(buildCommitTrailers("", "1").coAuthor).toContain("unknown via OpenClaw");
  });

  it("removes an already-missing hook directory", () => {
    const hooksDirectory = createCommitHookDirectory();
    removeCommitHookDirectory(hooksDirectory);
    expect(() => {
      removeCommitHookDirectory(hooksDirectory);
      removeCommitHookDirectory(undefined);
    }).not.toThrow();
  });
});
