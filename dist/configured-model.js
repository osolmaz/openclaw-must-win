import { getSessionEntry } from "openclaw/plugin-sdk/config-runtime";
import { formatModel } from "./model-attribution.js";
export function resolveConfiguredModel(input, readEntry = readSession) {
    const sessionModel = resolveSessionModel(input, readEntry);
    return sessionModel ?? resolveConfigModel(input.config, input.agentId);
}
function resolveSessionModel(input, readEntry) {
    if (input.sessionKey === undefined) {
        return undefined;
    }
    const session = readEntry(input.sessionKey, input.agentId);
    return session?.modelOverride
        ? formatModel(session.providerOverride, session.modelOverride)
        : undefined;
}
function resolveConfigModel(configValue, agentId) {
    const agents = readAgentsConfig(configValue);
    if (agents === undefined) {
        return undefined;
    }
    const agent = agents.list?.find((entry) => entry.id === agentId);
    return readModel(agent?.model) ?? readModel(agents.defaults?.model);
}
function readAgentsConfig(configValue) {
    return isRecord(configValue) ? configValue.agents : undefined;
}
function readSession(sessionKey, agentId) {
    try {
        return getSessionEntry({
            ...(agentId === undefined ? {} : { agentId }),
            sessionKey,
        });
    }
    catch {
        return undefined;
    }
}
function readModel(value) {
    const model = typeof value === "string" ? value : value?.primary;
    return readNonEmpty(model);
}
function readNonEmpty(value) {
    const normalized = value?.trim();
    return normalized === "" ? undefined : normalized;
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
//# sourceMappingURL=configured-model.js.map