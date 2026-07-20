import { describe, expect, it, vi } from "vitest";
import { ModelAttribution } from "../src/model-attribution.js";
import { rewriteExecToolCall } from "../src/tool-attribution.js";

const VERSION = "2026.6.11";

function createRecorder() {
  return { wrap: vi.fn((command: string) => `wrapped\n${command}`) };
}

describe("rewriteExecToolCall", () => {
  it("rewrites an exec command with the run model", () => {
    const models = new ModelAttribution();
    const commits = createRecorder();
    models.record({ model: "gpt-5.6-sol", runId: "run", sessionKey: "session" });
    models.record({ model: "other-model", runId: "other-run", sessionKey: "session" });

    const result = rewriteExecToolCall(
      {
        params: { command: "git commit -m test", timeout: 30 },
        runId: "run",
        sessionKey: "session",
        toolName: "exec",
      },
      models,
      commits,
      VERSION,
    );

    expect(result).toEqual({
      params: { command: "wrapped\ngit commit -m test", timeout: 30 },
    });
    expect(commits.wrap).toHaveBeenCalledWith("git commit -m test", "gpt-5.6-sol", VERSION);
  });

  it("falls back to the session model", () => {
    const models = new ModelAttribution();
    const commits = createRecorder();
    models.record({ model: "claude-sonnet-5", runId: "old", sessionKey: "session" });

    const result = rewriteExecToolCall(
      { params: { command: "git status" }, sessionKey: "session", toolName: "exec" },
      models,
      commits,
      VERSION,
    );

    expect(result?.params["command"]).toBe("wrapped\ngit status");
    expect(commits.wrap).toHaveBeenCalledWith("git status", "claude-sonnet-5", VERSION);
  });

  it.each([
    { GIT_CONFIG_COUNT: "1" },
    { GIT_CONFIG_PARAMETERS: "'core.hooksPath=/custom'" },
    { GIT_CONFIG_KEY_0: "user.name" },
    { GIT_CONFIG_VALUE_0: "Agent" },
    { GIT_CONFIG_KEY_0: "user.name", OTHER: "value" },
  ])("does not rewrite exec env Git configuration %#", (env) => {
    const commits = createRecorder();
    const models = new ModelAttribution();
    models.record({ model: "model", runId: "run" });

    const result = rewriteExecToolCall(
      { params: { command: "git commit -m test", env }, runId: "run", toolName: "exec" },
      models,
      commits,
      VERSION,
    );

    expect(result).toBeUndefined();
    expect(commits.wrap).not.toHaveBeenCalled();
  });

  it("rewrites commands with unrelated exec environment variables", () => {
    const commits = createRecorder();
    const models = new ModelAttribution();
    models.record({ model: "model", runId: "run" });

    const result = rewriteExecToolCall(
      {
        params: { command: "git commit -m test", env: { OTHER: "value" } },
        runId: "run",
        toolName: "exec",
      },
      models,
      commits,
      VERSION,
    );

    expect(result?.params["command"]).toBe("wrapped\ngit commit -m test");
  });

  it.each([
    {
      call: { params: { command: "git status" }, runId: "run", toolName: "read" },
      label: "other tools",
      recordModel: true,
    },
    {
      call: {
        params: { command: "git status" },
        runId: "run",
        toolKind: "code_mode_exec",
        toolName: "exec",
      },
      label: "code-mode execution",
      recordModel: true,
    },
    {
      call: { params: { command: 42 }, runId: "run", toolName: "exec" },
      label: "non-string commands",
      recordModel: true,
    },
    {
      call: {
        params: {
          command: "git commit -m test",
          env: { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "user.name" },
        },
        runId: "run",
        toolName: "exec",
      },
      label: "per-call Git configuration",
      recordModel: true,
    },
    {
      call: { params: { command: "git status" }, runId: "run", toolName: "exec" },
      label: "unknown models",
      recordModel: false,
    },
  ])("does not rewrite $label", ({ call, recordModel }) => {
    const commits = createRecorder();
    const models = new ModelAttribution();
    if (recordModel) {
      models.record({ model: "model", runId: "run" });
    }
    const result = rewriteExecToolCall(call, models, commits, VERSION);

    expect(result).toBeUndefined();
    expect(commits.wrap).not.toHaveBeenCalled();
  });
});
