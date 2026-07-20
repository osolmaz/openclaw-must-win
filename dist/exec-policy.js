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
export function canAttributeExec(input) {
    const globalExec = input.config.tools?.exec;
    const agentExec = input.config.agents?.list?.find((agent) => agent.id === input.agentId)?.tools
        ?.exec;
    const configured = applyLayer(applyLayer({ ask: "off", security: "full" }, globalExec), agentExec);
    const host = resolveHost(input.params["host"], agentExec, globalExec);
    return host === "gateway" && isFullAccess(configured) && isFullAccess(input.approvalPolicy);
}
function resolveHost(requestedHost, agentExec, globalExec) {
    return readRequestedHost(requestedHost) ?? agentExec?.host ?? globalExec?.host ?? "auto";
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
function readRequestedHost(value) {
    return value === "auto" || value === "gateway" || value === "node" || value === "sandbox"
        ? value
        : undefined;
}
//# sourceMappingURL=exec-policy.js.map