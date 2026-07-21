import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createHookChainer, runGitHook } from "../src/git-hook-runner.js";
import { installDispatcher } from "../src/installer.js";
import { resolveAttributionPaths } from "../src/paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "openclaw-must-win-hook-"));
  roots.push(root);
  const paths = resolveAttributionPaths(
    {
      OPENCLAW_MUST_WIN_RUNTIME_DIRECTORY: join(root, "runtime", "openclaw-must-win"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_RUNTIME_DIR: join(root, "ignored-runtime"),
      XDG_STATE_HOME: join(root, "state"),
    },
    root,
    1000,
  );
  return { paths, root };
}

const snapshot = {
  commandHashes: new Set<string>(),
  identity: { bootId: "boot", cgroup: "cgroup" },
};
const ticket = {
  bootId: "boot",
  cgroup: "cgroup",
  commandHash: "hash",
  expiresAt: 2,
  gatewayId: "gateway",
  mode: "required" as const,
  model: "openai/gpt-5.6-sol",
  openClawVersion: "2026.6.11",
  schemaVersion: 1 as const,
  startedAt: 1,
  ticketId: "ticket",
};

describe("runGitHook", () => {
  it("attributes a matched OpenClaw message hook after chained hooks", () => {
    const { paths } = fixture();
    const chainHooks = vi.fn(() => 0);
    const applyTrailers = vi.fn();
    const result = runGitHook("prepare-commit-msg", ["message"], paths, {
      applyTrailers,
      chainHooks,
      readSnapshot: () => snapshot,
      resolveContext: () => ({ origin: "openclaw", ticket }),
    });

    expect(result).toEqual({ status: 0 });
    expect(chainHooks).toHaveBeenCalledWith("prepare-commit-msg", ["message"]);
    expect(applyTrailers).toHaveBeenCalledWith("message", "openai/gpt-5.6-sol", "2026.6.11");
    expect(
      runGitHook("post-commit", [], paths, {
        applyTrailers,
        chainHooks: () => 0,
        readSnapshot: () => snapshot,
        resolveContext: () => ({ origin: "openclaw", ticket }),
      }),
    ).toEqual({ status: 0 });
  });

  it("blocks missing required attribution after existing hooks run", () => {
    const { paths } = fixture();
    const chainHooks = vi.fn(() => 0);
    const result = runGitHook("commit-msg", ["message"], paths, {
      chainHooks,
      readSnapshot: () => snapshot,
      resolveContext: () => ({ mode: "required", origin: "openclaw", reason: "missing" }),
    });

    expect(result.status).toBe(1);
    expect(result.message).toContain("missing execution context");
    expect(chainHooks).toHaveBeenCalledWith("commit-msg", ["message"]);
  });

  it("passes terminal and best-effort commits through without attribution", () => {
    const { paths } = fixture();
    const chainHooks = vi.fn(() => 0);
    const applyTrailers = vi.fn();
    for (const resolution of [
      { origin: "terminal" as const },
      { mode: "best-effort" as const, origin: "openclaw" as const, reason: "ambiguous" as const },
    ]) {
      expect(
        runGitHook("prepare-commit-msg", ["message"], paths, {
          applyTrailers,
          chainHooks,
          readSnapshot: () => snapshot,
          resolveContext: () => resolution,
        }),
      ).toEqual({ status: 0 });
    }
    expect(applyTrailers).not.toHaveBeenCalled();
  });

  it("propagates hook and trailer failures", () => {
    const { paths } = fixture();
    expect(
      runGitHook("commit-msg", [], paths, {
        chainHooks: () => 0,
        readSnapshot: () => snapshot,
        resolveContext: () => ({ origin: "openclaw", ticket }),
      }),
    ).toEqual({
      message: "openclaw-must-win: Git message hook did not provide a message file",
      status: 1,
    });
    expect(
      runGitHook("pre-commit", [], paths, {
        chainHooks: () => 42,
        readSnapshot: () => snapshot,
        resolveContext: () => ({ origin: "terminal" }),
      }),
    ).toEqual({ status: 42 });

    const trailerFailure = runGitHook("commit-msg", ["message"], paths, {
      applyTrailers: () => {
        throw new Error("broken trailer");
      },
      chainHooks: () => 0,
      readSnapshot: () => snapshot,
      resolveContext: () => ({ origin: "openclaw", ticket }),
    });
    expect(trailerFailure).toEqual({
      message: "openclaw-must-win: could not apply attribution: broken trailer",
      status: 1,
    });
    expect(
      runGitHook("prepare-commit-msg", ["message"], paths, {
        chainHooks: () => 0,
        readSnapshot: () => undefined,
      }),
    ).toEqual({ status: 0 });
    expect(
      runGitHook("prepare-commit-msg", ["message"], paths, {
        chainHooks: () => 0,
        readSnapshot: () => snapshot,
      }),
    ).toEqual({ status: 0 });
  });
});

describe("createHookChainer", () => {
  it("runs previous and repository hooks in order", () => {
    const { paths, root } = fixture();
    const source = join(root, "source");
    const previous = join(root, "previous");
    const repository = join(root, "repo");
    mkdirSync(source, { recursive: true });
    mkdirSync(previous, { recursive: true });
    writeFileSync(join(source, "cli.js"), "// runtime\n");
    let current: string | undefined = previous;
    installDispatcher({
      gitConfig: {
        getGlobalHooksPath: () => current,
        setGlobalHooksPath(value) {
          current = value;
        },
        unsetGlobalHooksPath() {
          current = undefined;
        },
      },
      paths,
      sourceRuntimeDirectory: source,
    });
    execFileSync("git", ["init", "-q", repository]);
    const marker = join(root, "marker");
    for (const [directory, value] of [
      [previous, "previous"],
      [join(repository, ".git", "hooks"), "repository"],
    ] as const) {
      const hook = join(directory, "pre-commit");
      writeFileSync(hook, `#!/bin/sh\nprintf '%s\\n' '${value}' >> '${marker}'\n`);
      chmodSync(hook, 0o755);
    }

    expect(createHookChainer(paths, repository)("pre-commit", [])).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("previous\nrepository\n");

    const state = JSON.parse(readFileSync(paths.installStatePath, "utf8")) as Record<
      string,
      unknown
    >;
    state["previousHooksPath"] = join(repository, ".git", "hooks");
    writeFileSync(paths.installStatePath, `${JSON.stringify(state)}\n`);
    writeFileSync(marker, "");
    expect(createHookChainer(paths, repository)("pre-commit", [])).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("repository\n");

    state["previousHooksPath"] = paths.hooksDirectory;
    writeFileSync(paths.installStatePath, `${JSON.stringify(state)}\n`);
    expect(createHookChainer(paths, root)("pre-commit", [])).toBe(0);
  });

  it("resolves relative previous hook directories from the repository", () => {
    const { paths, root } = fixture();
    const source = join(root, "source");
    const repository = join(root, "repo");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "cli.js"), "// runtime\n");
    execFileSync("git", ["init", "-q", repository]);
    const relativeDirectory = join(repository, "relative-hooks");
    mkdirSync(relativeDirectory);
    const marker = join(root, "relative-marker");
    const hook = join(relativeDirectory, "pre-commit");
    writeFileSync(hook, `#!/bin/sh\nprintf relative > '${marker}'\n`);
    chmodSync(hook, 0o755);
    let current: string | undefined = "relative-hooks";
    installDispatcher({
      gitConfig: {
        getGlobalHooksPath: () => current,
        setGlobalHooksPath(value) {
          current = value;
        },
        unsetGlobalHooksPath() {
          current = undefined;
        },
      },
      paths,
      sourceRuntimeDirectory: source,
    });
    expect(createHookChainer(paths, repository)("pre-commit", [])).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("relative");
  });
});

describe("hook chaining failures", () => {
  it("runs repository hooks when setup state is missing", () => {
    const { paths, root } = fixture();
    const repository = join(root, "repository-without-state");
    execFileSync("git", ["init", "-q", repository]);
    const marker = join(root, "missing-state-marker");
    const hook = join(repository, ".git", "hooks", "pre-commit");
    writeFileSync(hook, `#!/bin/sh\nprintf ran > '${marker}'\n`);
    chmodSync(hook, 0o755);

    expect(createHookChainer(paths, repository)("pre-commit", [])).toBe(0);
    expect(readFileSync(marker, "utf8")).toBe("ran");
  });

  it("propagates a delegated hook failure and tolerates missing setup", () => {
    const { paths, root } = fixture();
    expect(createHookChainer(paths, root)("pre-commit", [])).toBe(0);

    const noPreviousSource = join(root, "no-previous-source");
    mkdirSync(noPreviousSource, { recursive: true });
    writeFileSync(join(noPreviousSource, "cli.js"), "// runtime\n");
    let noPreviousCurrent: string | undefined;
    installDispatcher({
      gitConfig: {
        getGlobalHooksPath: () => noPreviousCurrent,
        setGlobalHooksPath(value) {
          noPreviousCurrent = value;
        },
        unsetGlobalHooksPath() {
          noPreviousCurrent = undefined;
        },
      },
      paths,
      sourceRuntimeDirectory: noPreviousSource,
    });
    expect(createHookChainer(paths)("pre-commit", [])).toBe(0);
    rmSync(paths.installStatePath, { force: true });

    const source = join(root, "source");
    const previous = join(root, "previous");
    mkdirSync(source, { recursive: true });
    mkdirSync(previous, { recursive: true });
    writeFileSync(join(source, "cli.js"), "// runtime\n");
    const failingHook = join(previous, "pre-commit");
    writeFileSync(failingHook, "#!/bin/sh\nexit 23\n");
    chmodSync(failingHook, 0o755);
    const missingInterpreterHook = join(previous, "commit-msg");
    writeFileSync(missingInterpreterHook, "#!/missing/interpreter\n");
    chmodSync(missingInterpreterHook, 0o755);
    const signalledHook = join(previous, "pre-push");
    writeFileSync(signalledHook, "#!/bin/sh\nkill -TERM $$\n");
    chmodSync(signalledHook, 0o755);
    let current: string | undefined = previous;
    installDispatcher({
      gitConfig: {
        getGlobalHooksPath: () => current,
        setGlobalHooksPath(value) {
          current = value;
        },
        unsetGlobalHooksPath() {
          current = undefined;
        },
      },
      paths,
      sourceRuntimeDirectory: source,
    });
    expect(createHookChainer(paths)("post-commit", [])).toBe(0);
    expect(createHookChainer(paths)("commit-msg", [])).toBe(1);
    expect(createHookChainer(paths)("pre-commit", [])).toBe(23);
    expect(createHookChainer(paths)("pre-push", [])).toBe(1);
  });
});
