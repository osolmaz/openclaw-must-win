export function rewriteExecToolCall(call, models, commits, openClawVersion) {
    if (call.toolName !== "exec" || call.toolKind === "code_mode_exec") {
        return undefined;
    }
    const command = call.params["command"];
    if (typeof command !== "string" || hasGitConfigEnvironment(call.params["env"])) {
        return undefined;
    }
    const model = models.resolve({ runId: call.runId, sessionKey: call.sessionKey });
    if (model === undefined) {
        return undefined;
    }
    return {
        params: {
            ...call.params,
            command: commits.wrap(command, model, openClawVersion),
        },
    };
}
function hasGitConfigEnvironment(value) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return false;
    }
    return Object.keys(value).some((key) => key === "GIT_CONFIG_COUNT" ||
        key === "GIT_CONFIG_PARAMETERS" ||
        key.startsWith("GIT_CONFIG_KEY_") ||
        key.startsWith("GIT_CONFIG_VALUE_"));
}
//# sourceMappingURL=tool-attribution.js.map