import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { afterEach, describe, expect, it } from "vitest";
import { AttributionContextStore } from "../src/context-store.js";
import { resolveAttributionPaths } from "../src/paths.js";
import { EXECUTION_ID_ENV, readProcessIdentity } from "../src/process-origin.js";
import { RuntimeAttribution } from "../src/runtime-attribution.js";

const roots: string[] = [];
const originalRuntimeDirectory = process.env["XDG_RUNTIME_DIR"];

afterEach(() => {
  if (originalRuntimeDirectory === undefined) {
    delete process.env["XDG_RUNTIME_DIR"];
  } else {
    process.env["XDG_RUNTIME_DIR"] = originalRuntimeDirectory;
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createApi(config: unknown = {}, pluginConfig: unknown = {}, startGateway = true) {
  const root = mkdtempSync(join(tmpdir(), "openclaw-must-win-runtime-"));
  roots.push(root);
  process.env["XDG_RUNTIME_DIR"] = root;
  const hooks = new Map<string, (event: never, context: never) => unknown>();
  const api = {
    logger: {
      warn() {
        return undefined;
      },
    },
    on(name: string, handler: (event: never, context: never) => unknown) {
      hooks.set(name, handler);
    },
    pluginConfig,
    runtime: {
      config: { current: () => config },
      version: "2026.6.11",
    },
  } as unknown as OpenClawPluginApi;
  new RuntimeAttribution(api).register();
  if (startGateway) {
    callHook(hooks, "gateway_start", {}, {});
  }
  return { hooks, root };
}

function callHook(
  hooks: Map<string, (event: never, context: never) => unknown>,
  name: string,
  event: unknown,
  context: unknown,
): unknown {
  const hook = hooks.get(name);
  if (!hook) {
    throw new Error(`missing ${name}`);
  }
  return hook(event as never, context as never);
}

describe("RuntimeAttribution", () => {
  it("records model-qualified execution tickets without command text", () => {
    const { hooks, root } = createApi();
    callHook(
      hooks,
      "model_call_started",
      { model: "gpt-5.6-sol", provider: "openai", runId: "run", sessionKey: "session" },
      {},
    );
    const executionEnvironment = callHook(
      hooks,
      "resolve_exec_env",
      { host: "gateway", sessionKey: "session", toolName: "exec" },
      { runId: "run", sessionKey: "session" },
    ) as Record<string, string>;
    expect(executionEnvironment[EXECUTION_ID_ENV]).toMatch(/^[0-9a-f-]{36}$/u);
    expect(
      callHook(
        hooks,
        "before_tool_call",
        {
          params: { command: "git commit -m secret", workdir: "/repo" },
          runId: "run",
          toolCallId: "tool",
          toolName: "exec",
        },
        { sessionKey: "session" },
      ),
    ).toBeUndefined();

    const ticketDirectory = join(root, "openclaw-must-win", "tickets");
    const ticketPath = join(ticketDirectory, readdirSync(ticketDirectory)[0] ?? "missing");
    const ticketText = readFileSync(ticketPath, "utf8");
    expect(ticketText).toContain("openai/gpt-5.6-sol");
    expect(ticketText).toContain(executionEnvironment[EXECUTION_ID_ENV] ?? "missing execution id");
    expect(ticketText).not.toContain("secret");

    callHook(hooks, "after_tool_call", { toolCallId: "tool", toolName: "exec" }, {});
    expect(readFileSync(ticketPath, "utf8")).toContain("completedAt");
    callHook(hooks, "session_end", { sessionKey: "session" }, {});
    callHook(hooks, "gateway_stop", {}, {});
  });

  it("keeps each owning ticket when an earlier execution id is left pending", () => {
    const { hooks } = createApi();
    callHook(
      hooks,
      "model_call_started",
      { model: "gpt-5.6-sol", provider: "openai", runId: "run", sessionKey: "session" },
      {},
    );
    const firstEnvironment = callHook(
      hooks,
      "resolve_exec_env",
      { host: "gateway", sessionKey: "session", toolName: "exec" },
      { runId: "run", sessionKey: "session" },
    ) as Record<string, string>;
    const secondEnvironment = callHook(
      hooks,
      "resolve_exec_env",
      { host: "gateway", sessionKey: "session", toolName: "exec" },
      { runId: "run", sessionKey: "session" },
    ) as Record<string, string>;

    callHook(
      hooks,
      "before_tool_call",
      {
        params: { command: "git commit -m current" },
        runId: "run",
        toolCallId: "second-tool",
        toolName: "exec",
      },
      { sessionKey: "session" },
    );

    const currentIdentity = readProcessIdentity();
    if (currentIdentity === undefined) {
      throw new Error("expected Linux process identity");
    }
    const resolution = new AttributionContextStore(resolveAttributionPaths()).resolve({
      commandHashes: new Set(),
      executionIds: new Set([secondEnvironment[EXECUTION_ID_ENV] ?? "missing"]),
      identity: currentIdentity,
    });
    expect(resolution.origin).toBe("openclaw");
    if (resolution.origin !== "openclaw") {
      throw new Error("expected OpenClaw process identity");
    }
    expect("ticket" in resolution).toBe(true);
    if (!("ticket" in resolution)) {
      throw new Error("expected an execution ticket");
    }
    expect(resolution.ticket.executionId).toBe(secondEnvironment[EXECUTION_ID_ENV]);
    expect(resolution.ticket.executionId).not.toBe(firstEnvironment[EXECUTION_ID_ENV]);
  });

  it("starts lazily, accepts code-mode exec, and ignores unrelated tools", () => {
    const { hooks, root } = createApi(
      { agents: { defaults: { model: { primary: "openai/gpt-5.6-sol" } } } },
      {},
      false,
    );
    callHook(
      hooks,
      "before_tool_call",
      { params: { command: "git commit" }, toolCallId: "ignored", toolName: "read" },
      {},
    );
    callHook(
      hooks,
      "before_tool_call",
      {
        params: { command: "git commit" },
        toolCallId: "tool",
        toolKind: "code_mode_exec",
        toolName: "exec",
      },
      {},
    );

    const tickets = readdirSync(join(root, "openclaw-must-win", "tickets"));
    expect(tickets).toHaveLength(1);
    callHook(hooks, "gateway_stop", {}, {});
  });
});
