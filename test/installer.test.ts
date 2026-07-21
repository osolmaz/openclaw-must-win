import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  doctorDispatcher,
  installDispatcher,
  readInstallState,
  uninstallDispatcher,
} from "../src/installer.js";
import { resolveAttributionPaths } from "../src/paths.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function fixture(initialHooksPath?: string) {
  const root = mkdtempSync(join(tmpdir(), "openclaw-must-win-install-"));
  roots.push(root);
  const source = join(root, "source");
  const paths = resolveAttributionPaths(
    {
      XDG_DATA_HOME: join(root, "data"),
      XDG_RUNTIME_DIR: join(root, "runtime"),
      XDG_STATE_HOME: join(root, "state"),
    },
    root,
    1000,
  );
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, "cli.js"), "// compiled runtime\n");
  let current: string | undefined = arguments.length === 0 ? "/previous/hooks" : initialHooksPath;
  const gitConfig = {
    getGlobalHooksPath: () => current,
    setGlobalHooksPath(value: string) {
      current = value;
    },
    unsetGlobalHooksPath() {
      current = undefined;
    },
  };
  return { current: () => current, gitConfig, paths, root, source };
}

describe("Git dispatcher installation", () => {
  it("installs self-contained hooks and preserves previous configuration", () => {
    const value = fixture();
    const state = installDispatcher({
      gitConfig: value.gitConfig,
      nodeExecutable: process.execPath,
      paths: value.paths,
      sourceRuntimeDirectory: value.source,
    });

    expect(value.current()).toBe(value.paths.hooksDirectory);
    expect(state.previousHooksPath).toBe("/previous/hooks");
    expect(readInstallState(value.paths.installStatePath)).toEqual(state);
    expect(readFileSync(join(value.paths.hooksDirectory, "prepare-commit-msg"), "utf8")).toContain(
      "hook 'prepare-commit-msg'",
    );
    expect(readFileSync(state.runtimeEntry, "utf8")).toContain("compiled runtime");
    expect(readFileSync(join(value.paths.runtimeFilesDirectory, "package.json"), "utf8")).toBe(
      '{"type":"module"}\n',
    );
  });

  it("is idempotent and restores the previous hooks path", () => {
    const value = fixture(undefined);
    writeFileSync(join(value.source, "cli.js"), "// one\n");
    installDispatcher({
      gitConfig: value.gitConfig,
      paths: value.paths,
      sourceRuntimeDirectory: value.source,
    });
    writeFileSync(join(value.source, "cli.js"), "// two\n");
    const updated = installDispatcher({
      gitConfig: value.gitConfig,
      paths: value.paths,
      sourceRuntimeDirectory: value.source,
    });
    expect(updated.previousHooksPath).toBeUndefined();
    expect(readFileSync(updated.runtimeEntry, "utf8")).toContain("two");

    uninstallDispatcher({ gitConfig: value.gitConfig, paths: value.paths });
    expect(value.current()).toBeUndefined();
    expect(readInstallState(value.paths.installStatePath)).toBeUndefined();
  });

  it("refuses to overwrite a later Git hooks change", () => {
    const value = fixture();
    installDispatcher({
      gitConfig: value.gitConfig,
      paths: value.paths,
      sourceRuntimeDirectory: value.source,
    });
    value.gitConfig.setGlobalHooksPath("/newer/hooks");

    expect(() =>
      installDispatcher({
        gitConfig: value.gitConfig,
        paths: value.paths,
        sourceRuntimeDirectory: value.source,
      }),
    ).toThrow("changed after setup");
    expect(() => {
      uninstallDispatcher({ gitConfig: value.gitConfig, paths: value.paths });
    }).toThrow("refusing to overwrite");
  });
});

describe("Git dispatcher diagnostics", () => {
  it("reports healthy and broken dispatcher state", () => {
    const value = fixture();
    installDispatcher({
      gitConfig: value.gitConfig,
      paths: value.paths,
      sourceRuntimeDirectory: value.source,
    });

    expect(
      doctorDispatcher({ gitConfig: value.gitConfig, paths: value.paths, platform: "linux" }),
    ).toMatchObject({ ok: true });
    rmSync(join(value.paths.hooksDirectory, "pre-commit"));
    rmSync(join(value.paths.runtimeFilesDirectory, "cli.js"));
    value.gitConfig.setGlobalHooksPath("/broken");
    const broken = doctorDispatcher({
      gitConfig: value.gitConfig,
      paths: value.paths,
      platform: "darwin",
    });
    expect(broken.ok).toBe(false);
    expect(broken.errors).toHaveLength(4);
    expect(
      doctorDispatcher({
        gitConfig: { ...value.gitConfig, getLocalHooksPath: () => "/local/hooks" },
        paths: value.paths,
      }).errors,
    ).toContain(
      "repository core.hooksPath overrides the dispatcher (/local/hooks); remove the local override",
    );
  });

  it("uses real isolated global Git configuration", () => {
    const value = fixture(undefined);
    const oldHome = process.env["HOME"];
    process.env["HOME"] = value.root;
    try {
      const state = installDispatcher({
        paths: value.paths,
        sourceRuntimeDirectory: value.source,
      });
      expect(readFileSync(join(process.env["HOME"], ".gitconfig"), "utf8")).toContain(
        state.hooksDirectory,
      );
      uninstallDispatcher({ paths: value.paths });
      expect(readInstallState(value.paths.installStatePath)).toBeUndefined();
    } finally {
      if (oldHome === undefined) {
        delete process.env["HOME"];
      } else {
        process.env["HOME"] = oldHome;
      }
    }
  });

  it("rolls back setup failures and validates missing state", () => {
    const value = fixture(undefined);
    let current: string | undefined;
    const gitConfig = {
      getGlobalHooksPath: () => current,
      setGlobalHooksPath(target: string) {
        if (target === value.paths.hooksDirectory) {
          throw new Error("cannot write Git config");
        }
        current = target;
      },
      unsetGlobalHooksPath() {
        current = undefined;
      },
    };
    expect(() =>
      installDispatcher({
        gitConfig,
        paths: value.paths,
        sourceRuntimeDirectory: value.source,
      }),
    ).toThrow();
    rmSync(value.paths.installStatePath, { force: true });
    expect(() => {
      uninstallDispatcher({ gitConfig: value.gitConfig, paths: value.paths });
    }).toThrow("not set up");
    expect(doctorDispatcher({ gitConfig: value.gitConfig, paths: value.paths }).ok).toBe(false);
    writeFileSync(value.paths.installStatePath, "invalid json\n", { flag: "w" });
    expect(readInstallState(value.paths.installStatePath)).toBeUndefined();
    for (const invalid of [
      null,
      [],
      {},
      { schemaVersion: 1 },
      { schemaVersion: 1, hooksDirectory: "hooks", installedAt: 1 },
      {
        schemaVersion: 1,
        hooksDirectory: "hooks",
        installedAt: "date",
        nodeExecutable: 42,
      },
      {
        schemaVersion: 1,
        hooksDirectory: "hooks",
        installedAt: "date",
        nodeExecutable: "node",
        runtimeEntry: 42,
      },
      {
        schemaVersion: 1,
        hooksDirectory: "hooks",
        installedAt: "date",
        nodeExecutable: "node",
        runtimeEntry: "runtime",
        previousHooksPath: 42,
      },
    ]) {
      writeFileSync(value.paths.installStatePath, `${JSON.stringify(invalid)}\n`);
      expect(readInstallState(value.paths.installStatePath)).toBeUndefined();
    }
  });

  it("restores an existing hooks path when setup cannot write", () => {
    const value = fixture("/existing/hooks");
    let current: string | undefined = "/existing/hooks";
    expect(() =>
      installDispatcher({
        gitConfig: {
          getGlobalHooksPath: () => current,
          setGlobalHooksPath(target) {
            if (target === value.paths.hooksDirectory) {
              throw new Error("write failed");
            }
            current = target;
          },
          unsetGlobalHooksPath() {
            current = undefined;
          },
        },
        paths: value.paths,
        sourceRuntimeDirectory: value.source,
      }),
    ).toThrow("write failed");
    expect(current).toBe("/existing/hooks");
  });

  it("keeps a runtime that is already in its installed location", () => {
    const value = fixture();
    mkdirSync(value.paths.runtimeFilesDirectory, { recursive: true });
    writeFileSync(join(value.paths.runtimeFilesDirectory, "cli.js"), "// in place\n");
    const state = installDispatcher({
      gitConfig: value.gitConfig,
      paths: value.paths,
      sourceRuntimeDirectory: value.paths.runtimeFilesDirectory,
    });
    expect(readFileSync(state.runtimeEntry, "utf8")).toContain("in place");
  });
});
