import { describe, expect, it } from "vitest";
import { isGitHookName, isMessageHook } from "../src/git-hooks.js";
import { resolveAttributionPaths } from "../src/paths.js";

describe("attribution paths", () => {
  it("uses XDG directories when configured", () => {
    expect(
      resolveAttributionPaths(
        {
          XDG_DATA_HOME: "/data",
          XDG_RUNTIME_DIR: "/runtime",
          XDG_STATE_HOME: "/state",
        },
        "/home/test",
        1000,
      ),
    ).toEqual({
      dataDirectory: "/data/openclaw-must-win",
      hooksDirectory: "/data/openclaw-must-win/hooks",
      installStatePath: "/state/openclaw-must-win/install.json",
      runtimeDirectory: "/runtime/openclaw-must-win",
      runtimeFilesDirectory: "/data/openclaw-must-win/runtime",
      stateDirectory: "/state/openclaw-must-win",
    });
  });

  it("falls back to home and uid paths", () => {
    const paths = resolveAttributionPaths({}, "/home/test", 1000);
    expect(paths.dataDirectory).toBe("/home/test/.local/share/openclaw-must-win");
    expect(resolveAttributionPaths({}, "/home/test").runtimeDirectory).toContain("/run/user/");
    expect(paths.runtimeDirectory).toBe("/run/user/1000/openclaw-must-win");
    expect(resolveAttributionPaths({}, "/home/test", null).runtimeDirectory).toContain(
      ".local/state/runtime",
    );
    expect(
      resolveAttributionPaths(
        { XDG_DATA_HOME: " ", XDG_RUNTIME_DIR: " ", XDG_STATE_HOME: " " },
        "/home/test",
        null,
      ).runtimeDirectory,
    ).toContain(".local/state/runtime");
  });
});

describe("Git hook names", () => {
  it("recognizes supported message hooks", () => {
    expect(isGitHookName("prepare-commit-msg")).toBe(true);
    expect(isGitHookName("unknown")).toBe(false);
    expect(isMessageHook("prepare-commit-msg")).toBe(true);
    expect(isMessageHook("commit-msg")).toBe(true);
    expect(isMessageHook("pre-commit")).toBe(false);
  });
});
