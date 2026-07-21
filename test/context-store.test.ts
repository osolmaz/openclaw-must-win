import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AttributionContextStore } from "../src/context-store.js";
import { resolveAttributionPaths } from "../src/paths.js";
import { hashCommand } from "../src/process-origin.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function createStore(nowValue = 1_000) {
  const root = mkdtempSync(join(tmpdir(), "openclaw-must-win-context-"));
  roots.push(root);
  let now = nowValue;
  const paths = resolveAttributionPaths(
    {
      XDG_DATA_HOME: join(root, "data"),
      XDG_RUNTIME_DIR: join(root, "runtime"),
      XDG_STATE_HOME: join(root, "state"),
    },
    root,
    1000,
  );
  return {
    advance(milliseconds: number) {
      now += milliseconds;
    },
    paths,
    store: new AttributionContextStore(paths, () => now),
  };
}

const identity = { bootId: "boot", cgroup: "0::/openclaw.service" };
const unrelated = { bootId: "boot", cgroup: "0::/terminal.scope" };

function snapshot(command?: string, currentIdentity = identity) {
  return {
    commandHashes: new Set(command === undefined ? [] : [hashCommand(command)]),
    identity: currentIdentity,
  };
}

describe("AttributionContextStore", () => {
  it("resolves an exact active tool ticket", () => {
    const { store } = createStore();
    const gateway = store.registerGateway({
      identity,
      mode: "required",
      openClawVersion: "2026.6.11",
      pid: 42,
    });
    const ticket = store.recordTool({
      command: "git commit -m test",
      gateway,
      model: "openai/gpt-5.6-sol",
      runId: "run",
      sessionKey: "session",
      toolCallId: "tool",
    });

    expect(store.resolve(snapshot("git commit -m test"))).toEqual({
      origin: "openclaw",
      ticket,
    });
    expect(store.resolve(snapshot(undefined, unrelated))).toEqual({ origin: "terminal" });
  });

  it("retains a completed ticket for delayed commits", () => {
    const context = createStore();
    const gateway = context.store.registerGateway({
      identity,
      mode: "required",
      openClawVersion: "1",
    });
    context.store.recordTool({
      command: "./commit-later.sh",
      gateway,
      model: "model",
      toolCallId: "delayed",
    });
    context.advance(1_000);
    context.store.completeTool("delayed", gateway.gatewayId);

    const resolution = context.store.resolve(snapshot("./commit-later.sh"));
    expect(resolution.origin).toBe("openclaw");
    expect("ticket" in resolution && resolution.ticket.completedAt).toBe(2_000);
  });

  it("rejects missing and ambiguous required contexts", () => {
    const { store } = createStore();
    const gateway = store.registerGateway({
      identity,
      mode: "required",
      openClawVersion: "1",
    });
    expect(store.resolve(snapshot())).toEqual({
      mode: "required",
      origin: "openclaw",
      reason: "missing",
    });

    store.recordTool({ command: "one", gateway, model: "one", toolCallId: "one" });
    store.recordTool({ command: "two", gateway, model: "two", toolCallId: "two" });
    expect(store.resolve(snapshot())).toEqual({
      mode: "required",
      origin: "openclaw",
      reason: "ambiguous",
    });
  });

  it("reports best-effort ambiguity without upgrading it to required", () => {
    const { store } = createStore();
    const gateway = store.registerGateway({
      identity,
      mode: "best-effort",
      openClawVersion: "1",
    });
    store.recordTool({ command: "one", gateway, model: "one", toolCallId: "one" });
    store.recordTool({ command: "two", gateway, model: "two", toolCallId: "two" });

    expect(store.resolve(snapshot())).toEqual({
      mode: "best-effort",
      origin: "openclaw",
      reason: "ambiguous",
    });
  });

  it("expires gateway and completed ticket records", () => {
    const context = createStore();
    const gateway = context.store.registerGateway({
      identity,
      mode: "required",
      openClawVersion: "1",
    });
    context.store.recordTool({
      command: "git commit",
      gateway,
      model: "model",
      toolCallId: "tool",
    });
    context.store.completeTool("tool", gateway.gatewayId);
    context.advance(31 * 60 * 1_000);
    context.store.prune();

    expect(context.store.resolve(snapshot("git commit"))).toEqual({ origin: "terminal" });
  });

  it("ignores malformed and missing ticket records", () => {
    const context = createStore();
    mkdirSync(join(context.paths.runtimeDirectory, "tickets"), { recursive: true });
    mkdirSync(join(context.paths.runtimeDirectory, "gateways"), { recursive: true });
    writeFileSync(join(context.paths.runtimeDirectory, "tickets", "bad.json"), "not json\n");
    writeFileSync(join(context.paths.runtimeDirectory, "gateways", "bad.json"), "{}\n");
    context.store.completeTool(undefined, "gateway");
    context.store.completeTool("missing", "gateway");
    context.store.prune();
    expect(context.store.resolve(snapshot())).toEqual({ origin: "terminal" });
  });

  it("refreshes and unregisters gateway records safely", () => {
    const context = createStore();
    const gateway = context.store.registerGateway({
      identity,
      mode: "required",
      openClawVersion: "1",
      pid: 44,
    });
    context.advance(100);
    const refreshed = context.store.refreshGateway(gateway);
    expect(refreshed.gatewayId).toBe(gateway.gatewayId);
    expect(refreshed.expiresAt).toBeGreaterThan(gateway.expiresAt);

    context.store.unregisterGateway(gateway.gatewayId);
    context.store.unregisterGateway("../../unsafe");
    expect(context.store.resolve(snapshot())).toEqual({ origin: "terminal" });
  });
});
