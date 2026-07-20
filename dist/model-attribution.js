const MAX_TRACKED_RUNS = 1_024;
export class ModelAttribution {
    modelsByRun = new Map();
    modelsBySession = new Map();
    sessionsByRun = new Map();
    record(call) {
        if (!this.modelsByRun.has(call.runId) && this.modelsByRun.size >= MAX_TRACKED_RUNS) {
            const oldestRunId = this.modelsByRun.keys().next().value;
            if (oldestRunId !== undefined) {
                this.modelsByRun.delete(oldestRunId);
                this.sessionsByRun.delete(oldestRunId);
            }
        }
        this.modelsByRun.set(call.runId, call.model);
        if (call.sessionKey !== undefined) {
            this.modelsBySession.set(call.sessionKey, call.model);
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
        if (sessionKey === undefined) {
            return;
        }
        this.modelsBySession.delete(sessionKey);
        for (const [runId, runSessionKey] of this.sessionsByRun) {
            if (runSessionKey === sessionKey) {
                this.modelsByRun.delete(runId);
                this.sessionsByRun.delete(runId);
            }
        }
    }
    clear() {
        this.modelsByRun.clear();
        this.modelsBySession.clear();
        this.sessionsByRun.clear();
    }
}
//# sourceMappingURL=model-attribution.js.map