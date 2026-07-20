import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { describe, expect, it, vi } from "vitest";
import { canAttributeExec, type ApprovalPolicy, readSessionExecLayer } from "../src/exec-policy.js";

const FULL_APPROVALS: ApprovalPolicy = { ask: "off", security: "full" };

function canAttribute(
  config: OpenClawConfig,
  approvalPolicy: ApprovalPolicy = FULL_APPROVALS,
  params: Record<string, unknown> = {},
  agentId = "main",
): boolean {
  return canAttributeExec({ agentId, approvalPolicy, config, params, sessionExec: undefined });
}

describe("readSessionExecLayer", () => {
  it("reads validated session overrides and fails closed on store errors", () => {
    const get = vi.fn(() => ({
      execAsk: "always",
      execHost: "sandbox",
      execSecurity: "allowlist",
      sessionId: "id",
      updatedAt: 1,
    }));

    expect(readSessionExecLayer("session", "main", { get })).toEqual({
      ask: "always",
      host: "sandbox",
      security: "allowlist",
    });
    expect(get).toHaveBeenCalledWith({ agentId: "main", sessionKey: "session" });
    expect(readSessionExecLayer(undefined, "main", { get })).toBeUndefined();
    expect(readSessionExecLayer("missing", undefined, { get: () => undefined })).toBeUndefined();
    expect(
      readSessionExecLayer("invalid", undefined, {
        get: () => ({
          execAsk: "invalid",
          execHost: "invalid",
          execSecurity: "invalid",
          sessionId: "id",
          updatedAt: 1,
        }),
      }),
    ).toEqual({});

    get.mockImplementation(() => {
      throw new Error("unreadable");
    });
    expect(readSessionExecLayer("session", "main", { get })).toBeNull();
  });
});

describe("canAttributeExec", () => {
  it("allows an explicit full-access Gateway policy", () => {
    const config: OpenClawConfig = {
      tools: { exec: { ask: "off", host: "gateway", security: "full" } },
    };
    expect(canAttribute(config)).toBe(true);
  });

  it.each([
    { exec: { ask: "off" as const, host: "gateway" as const, security: "allowlist" as const } },
    { exec: { ask: "on-miss" as const, host: "gateway" as const, security: "full" as const } },
    { exec: { host: "gateway" as const, mode: "allowlist" as const } },
    { exec: { host: "gateway" as const, mode: "ask" as const } },
    { exec: { host: "sandbox" as const, mode: "full" as const } },
    { exec: { host: "node" as const, mode: "full" as const } },
    { exec: { host: "auto" as const, mode: "full" as const } },
  ])("rejects unsafe config %#", ({ exec }) => {
    expect(canAttribute({ tools: { exec } })).toBe(false);
  });

  it.each([
    { ask: "on-miss" as const, security: "full" as const },
    { ask: "always" as const, security: "full" as const },
    { ask: "off" as const, security: "allowlist" as const },
    { ask: "off" as const, security: "deny" as const },
  ])("rejects restrictive approval-file policy %#", (approvalPolicy) => {
    const config: OpenClawConfig = {
      tools: { exec: { host: "gateway", mode: "full" } },
    };
    expect(canAttribute(config, approvalPolicy)).toBe(false);
  });

  it("applies per-agent policy over global policy", () => {
    const config: OpenClawConfig = {
      agents: {
        list: [
          {
            id: "main",
            tools: { exec: { ask: "off", host: "gateway", security: "full" } },
          },
        ],
      },
      tools: { exec: { host: "sandbox", mode: "deny" } },
    };
    expect(canAttribute(config)).toBe(true);
    expect(canAttribute(config, FULL_APPROVALS, {}, "other")).toBe(false);
  });

  it("applies session policy over agent and global policy", () => {
    const config: OpenClawConfig = {
      tools: { exec: { host: "gateway", mode: "full" } },
    };
    expect(
      canAttributeExec({
        agentId: "main",
        approvalPolicy: FULL_APPROVALS,
        config,
        params: {},
        sessionExec: { host: "sandbox" },
      }),
    ).toBe(false);
    expect(
      canAttributeExec({
        agentId: "main",
        approvalPolicy: FULL_APPROVALS,
        config,
        params: {},
        sessionExec: { ask: "always" },
      }),
    ).toBe(false);
    expect(
      canAttributeExec({
        agentId: "main",
        approvalPolicy: FULL_APPROVALS,
        config,
        params: {},
        sessionExec: null,
      }),
    ).toBe(false);
  });

  it("honors a requested host and rejects unknown or missing host policy", () => {
    const config: OpenClawConfig = {
      tools: { exec: { host: "gateway", mode: "full" } },
    };
    expect(canAttribute(config, FULL_APPROVALS, { host: "node" })).toBe(false);
    expect(canAttribute(config, FULL_APPROVALS, { host: "gateway" })).toBe(true);
    expect(canAttribute({}, FULL_APPROVALS, { host: "invalid" })).toBe(false);
  });
});
