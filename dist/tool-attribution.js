export function rewriteExecToolCall(call, models, commits, openClawVersion) {
    if (call.toolName !== "exec" || call.toolKind === "code_mode_exec") {
        return undefined;
    }
    const command = call.params["command"];
    if (typeof command !== "string") {
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
//# sourceMappingURL=tool-attribution.js.map