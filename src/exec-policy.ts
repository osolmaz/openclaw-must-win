import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  loadExecApprovals,
  resolveExecApprovalsFromFile,
  resolveExecPolicyForMode,
} from "openclaw/plugin-sdk/infra-runtime";

type ExecLayer = {
  ask?: "always" | "off" | "on-miss";
  host?: "auto" | "gateway" | "node" | "sandbox";
  mode?: "allowlist" | "ask" | "auto" | "deny" | "full";
  security?: "allowlist" | "deny" | "full";
};

export type ApprovalPolicy = {
  ask: "always" | "off" | "on-miss";
  security: "allowlist" | "deny" | "full";
};

export type ExecAttributionPolicyInput = {
  agentId?: string | undefined;
  approvalPolicy: ApprovalPolicy;
  config: OpenClawConfig;
  params: Record<string, unknown>;
};

export function readApprovalPolicy(agentId: string | undefined): ApprovalPolicy {
  try {
    const resolved = resolveExecApprovalsFromFile({
      file: loadExecApprovals(),
      ...(agentId === undefined ? {} : { agentId }),
      overrides: { ask: "off", security: "full" },
    }).agent;
    return { ask: resolved.ask, security: resolved.security };
  } catch {
    return { ask: "always", security: "deny" };
  }
}

export function canAttributeExec(input: ExecAttributionPolicyInput): boolean {
  const globalExec = input.config.tools?.exec;
  const agentExec = input.config.agents?.list?.find((agent) => agent.id === input.agentId)?.tools
    ?.exec;
  const configured = applyLayer(
    applyLayer({ ask: "off", security: "full" }, globalExec),
    agentExec,
  );
  const host = resolveHost(input.params["host"], agentExec, globalExec);

  return host === "gateway" && isFullAccess(configured) && isFullAccess(input.approvalPolicy);
}

function resolveHost(
  requestedHost: unknown,
  agentExec: ExecLayer | undefined,
  globalExec: ExecLayer | undefined,
): ExecLayer["host"] {
  return readRequestedHost(requestedHost) ?? agentExec?.host ?? globalExec?.host ?? "auto";
}

function isFullAccess(policy: ApprovalPolicy): boolean {
  return policy.security === "full" && policy.ask === "off";
}

function applyLayer(base: ApprovalPolicy, layer: ExecLayer | undefined): ApprovalPolicy {
  if (layer?.mode !== undefined) {
    return resolveExecPolicyForMode(layer.mode);
  }
  return {
    ask: layer?.ask ?? base.ask,
    security: layer?.security ?? base.security,
  };
}

function readRequestedHost(value: unknown): ExecLayer["host"] | undefined {
  return value === "auto" || value === "gateway" || value === "node" || value === "sandbox"
    ? value
    : undefined;
}
