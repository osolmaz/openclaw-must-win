import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { describe, expect, it } from "vitest";
import { canAttributeExec, type ApprovalPolicy } from "../src/exec-policy.js";

const FULL_APPROVALS: ApprovalPolicy = { ask: "off", security: "full" };

function canAttribute(
  config: OpenClawConfig,
  approvalPolicy: ApprovalPolicy = FULL_APPROVALS,
  params: Record<string, unknown> = {},
  agentId = "main",
): boolean {
  return canAttributeExec({ agentId, approvalPolicy, config, params });
}

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

  it("honors a requested host and rejects unknown or missing host policy", () => {
    const config: OpenClawConfig = {
      tools: { exec: { host: "gateway", mode: "full" } },
    };
    expect(canAttribute(config, FULL_APPROVALS, { host: "node" })).toBe(false);
    expect(canAttribute(config, FULL_APPROVALS, { host: "gateway" })).toBe(true);
    expect(canAttribute({}, FULL_APPROVALS, { host: "invalid" })).toBe(false);
  });
});
