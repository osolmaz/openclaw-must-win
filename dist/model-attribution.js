const MAX_TRACKED_RUNS = 1_024;
const MAX_TRACKED_SESSIONS = 1_024;
export class ModelAttribution {
    modelsByRun = new Map();
    modelsBySession = new Map();
    sessionsByRun = new Map();
    record(call) {
        const model = formatModel(call.provider, call.model);
        if (!this.modelsByRun.has(call.runId) && this.modelsByRun.size >= MAX_TRACKED_RUNS) {
            const oldestRunId = this.modelsByRun.keys().next().value;
            if (oldestRunId !== undefined) {
                this.modelsByRun.delete(oldestRunId);
                this.sessionsByRun.delete(oldestRunId);
            }
        }
        this.modelsByRun.set(call.runId, model);
        if (call.sessionKey !== undefined) {
            if (!this.modelsBySession.has(call.sessionKey) &&
                this.modelsBySession.size >= MAX_TRACKED_SESSIONS) {
                const oldestSessionKey = this.modelsBySession.keys().next().value;
                if (oldestSessionKey !== undefined) {
                    this.evictSession(oldestSessionKey);
                }
            }
            this.modelsBySession.set(call.sessionKey, model);
            this.sessionsByRun.set(call.runId, call.sessionKey);
        }
    }
    resolve(context) {
        if (context.runId !== undefined) {
            const runModel = this.modelsByRun.get(context.runId);
            if (runModel !== undefined) {
                return runModel;
            }
        }
        return context.sessionKey === undefined
            ? undefined
            : this.modelsBySession.get(context.sessionKey);
    }
    endSession(sessionKey) {
        if (sessionKey !== undefined) {
            this.evictSession(sessionKey);
        }
    }
    clear() {
        this.modelsByRun.clear();
        this.modelsBySession.clear();
        this.sessionsByRun.clear();
    }
    evictSession(sessionKey) {
        this.modelsBySession.delete(sessionKey);
        for (const [runId, runSessionKey] of this.sessionsByRun) {
            if (runSessionKey === sessionKey) {
                this.modelsByRun.delete(runId);
                this.sessionsByRun.delete(runId);
            }
        }
    }
}
export function formatModel(provider, model) {
    const normalizedModel = model.trim();
    const normalizedProvider = provider?.trim();
    if (!normalizedProvider || normalizedModel.includes("/")) {
        return normalizedModel;
    }
    return `${normalizedProvider}/${normalizedModel}`;
}
//# sourceMappingURL=model-attribution.js.map