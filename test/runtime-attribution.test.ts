import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import { afterEach, describe, expect, it } from "vitest";
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
    expect(ticketText).not.toContain("secret");

    callHook(hooks, "after_tool_call", { toolCallId: "tool", toolName: "exec" }, {});
    expect(readFileSync(ticketPath, "utf8")).toContain("completedAt");
    callHook(hooks, "session_end", { sessionKey: "session" }, {});
    callHook(hooks, "gateway_stop", {}, {});
  });

  it("uses configured model fallback and ignores unrelated tools", () => {
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
      { params: { command: "git commit" }, toolCallId: "tool", toolName: "exec" },
      {},
    );

    const tickets = readdirSync(join(root, "openclaw-must-win", "tickets"));
    expect(tickets).toHaveLength(1);
    callHook(hooks, "gateway_stop", {}, {});
  });
});
