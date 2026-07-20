import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { getSessionEntry } from "openclaw/plugin-sdk/config-runtime";
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
  sessionExec: ExecLayer | null | undefined;
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

type SessionStoreRuntime = {
  get: typeof getSessionEntry;
};

const DEFAULT_SESSION_STORE_RUNTIME: SessionStoreRuntime = {
  get: getSessionEntry,
};

export function readSessionExecLayer(
  sessionKey: string | undefined,
  agentId: string | undefined,
  runtime: SessionStoreRuntime = DEFAULT_SESSION_STORE_RUNTIME,
): ExecLayer | null | undefined {
  if (sessionKey === undefined) {
    return undefined;
  }
  try {
    const entry = runtime.get({
      ...(agentId === undefined ? {} : { agentId }),
      sessionKey,
    });
    return entry === undefined ? undefined : normalizeSessionExecLayer(entry);
  } catch {
    return null;
  }
}

export function canAttributeExec(input: ExecAttributionPolicyInput): boolean {
  if (input.sessionExec === null) {
    return false;
  }
  return canAttributeWithReadableSession({ ...input, sessionExec: input.sessionExec });
}

function canAttributeWithReadableSession(
  input: Omit<ExecAttributionPolicyInput, "sessionExec"> & {
    sessionExec: ExecLayer | undefined;
  },
): boolean {
  const globalExec = input.config.tools?.exec;
  const agentExec = input.config.agents?.list?.find((agent) => agent.id === input.agentId)?.tools
    ?.exec;
  const configured = applyLayer(
    applyLayer(applyLayer({ ask: "off", security: "full" }, globalExec), agentExec),
    input.sessionExec,
  );
  const host = resolveHost(input.params["host"], input.sessionExec, agentExec, globalExec);

  return isAttributionAllowed(host, configured, input.approvalPolicy, input.params["ask"]);
}

function isAttributionAllowed(
  host: ExecLayer["host"],
  configured: ApprovalPolicy,
  approvals: ApprovalPolicy,
  requestedAsk: unknown,
): boolean {
  return (
    host === "gateway" &&
    isFullAccess(configured) &&
    isFullAccess(approvals) &&
    isPerCallApprovalDisabled(requestedAsk)
  );
}

function resolveHost(
  requestedHost: unknown,
  sessionExec: ExecLayer | undefined,
  agentExec: ExecLayer | undefined,
  globalExec: ExecLayer | undefined,
): ExecLayer["host"] {
  return (
    readRequestedHost(requestedHost) ??
    sessionExec?.host ??
    agentExec?.host ??
    globalExec?.host ??
    "auto"
  );
}

function isPerCallApprovalDisabled(value: unknown): boolean {
  return value === undefined || value === "off";
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

function normalizeSessionExecLayer(entry: {
  execAsk?: string;
  execHost?: string;
  execSecurity?: string;
}): ExecLayer {
  return {
    ...(isAsk(entry.execAsk) ? { ask: entry.execAsk } : {}),
    ...(isHost(entry.execHost) ? { host: entry.execHost } : {}),
    ...(isSecurity(entry.execSecurity) ? { security: entry.execSecurity } : {}),
  };
}

function isAsk(value: unknown): value is NonNullable<ExecLayer["ask"]> {
  return value === "always" || value === "off" || value === "on-miss";
}

function isHost(value: unknown): value is NonNullable<ExecLayer["host"]> {
  return value === "auto" || value === "gateway" || value === "node" || value === "sandbox";
}

function isSecurity(value: unknown): value is NonNullable<ExecLayer["security"]> {
  return value === "allowlist" || value === "deny" || value === "full";
}

function readRequestedHost(value: unknown): ExecLayer["host"] | undefined {
  return value === "auto" || value === "gateway" || value === "node" || value === "sandbox"
    ? value
    : undefined;
}
