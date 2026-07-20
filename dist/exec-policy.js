import { getSessionEntry } from "openclaw/plugin-sdk/config-runtime";
import { normalizeAgentId } from "openclaw/plugin-sdk/routing";
import { loadExecApprovals, resolveExecApprovalsFromFile, resolveExecPolicyForMode, } from "openclaw/plugin-sdk/infra-runtime";
export function readApprovalPolicy(agentId) {
    try {
        const resolved = resolveExecApprovalsFromFile({
            file: loadExecApprovals(),
            ...(agentId === undefined ? {} : { agentId }),
            overrides: { ask: "off", security: "full" },
        }).agent;
        return { ask: resolved.ask, security: resolved.security };
    }
    catch {
        return { ask: "always", security: "deny" };
    }
}
const DEFAULT_SESSION_STORE_RUNTIME = {
    get: getSessionEntry,
};
export function readSessionExecLayer(sessionKey, agentId, runtime = DEFAULT_SESSION_STORE_RUNTIME) {
    if (sessionKey === undefined) {
        return undefined;
    }
    try {
        const entry = runtime.get({
            ...(agentId === undefined ? {} : { agentId }),
            sessionKey,
        });
        return entry === undefined ? undefined : normalizeSessionExecLayer(entry);
    }
    catch {
        return null;
    }
}
export function canAttributeExec(input) {
    if (input.sessionExec === null) {
        return false;
    }
    return canAttributeWithReadableSession({ ...input, sessionExec: input.sessionExec });
}
function canAttributeWithReadableSession(input) {
    const globalExec = input.config.tools?.exec;
    const agentId = normalizeAgentId(input.agentId);
    const agentExec = input.config.agents?.list?.find((agent) => normalizeAgentId(agent.id) === agentId)?.tools?.exec;
    const configured = applyLayer(applyLayer(applyLayer({ ask: "off", security: "full" }, globalExec), agentExec), input.sessionExec);
    const host = resolveHost(input.params["host"], input.sessionExec, agentExec, globalExec);
    return isAttributionAllowed(host, configured, input.approvalPolicy, input.params["ask"]);
}
function isAttributionAllowed(host, configured, approvals, requestedAsk) {
    return (host === "gateway" &&
        isFullAccess(configured) &&
        isFullAccess(approvals) &&
        isPerCallApprovalDisabled(requestedAsk));
}
function resolveHost(requestedHost, sessionExec, agentExec, globalExec) {
    return (readRequestedHost(requestedHost) ??
        sessionExec?.host ??
        agentExec?.host ??
        globalExec?.host ??
        "auto");
}
function isPerCallApprovalDisabled(value) {
    return value === undefined || value === "off";
}
function isFullAccess(policy) {
    return policy.security === "full" && policy.ask === "off";
}
function applyLayer(base, layer) {
    if (layer?.mode !== undefined) {
        return resolveExecPolicyForMode(layer.mode);
    }
    return {
        ask: layer?.ask ?? base.ask,
        security: layer?.security ?? base.security,
    };
}
function normalizeSessionExecLayer(entry) {
    return {
        ...(isAsk(entry.execAsk) ? { ask: entry.execAsk } : {}),
        ...(isHost(entry.execHost) ? { host: entry.execHost } : {}),
        ...(isSecurity(entry.execSecurity) ? { security: entry.execSecurity } : {}),
    };
}
function isAsk(value) {
    return value === "always" || value === "off" || value === "on-miss";
}
function isHost(value) {
    return value === "auto" || value === "gateway" || value === "node" || value === "sandbox";
}
function isSecurity(value) {
    return value === "allowlist" || value === "deny" || value === "full";
}
function readRequestedHost(value) {
    return value === "auto" || value === "gateway" || value === "node" || value === "sandbox"
        ? value
        : undefined;
}
//# sourceMappingURL=exec-policy.js.map