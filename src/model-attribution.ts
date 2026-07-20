export type ModelCall = {
  model: string;
  runId: string;
  sessionKey?: string;
};

export type AttributionContext = {
  runId?: string | undefined;
  sessionKey?: string | undefined;
};

const MAX_TRACKED_RUNS = 1_024;
const MAX_TRACKED_SESSIONS = 1_024;

export class ModelAttribution {
  private readonly modelsByRun = new Map<string, string>();
  private readonly modelsBySession = new Map<string, string>();
  private readonly sessionsByRun = new Map<string, string>();

  record(call: ModelCall): void {
    if (!this.modelsByRun.has(call.runId) && this.modelsByRun.size >= MAX_TRACKED_RUNS) {
      const oldestRunId = this.modelsByRun.keys().next().value;
      if (oldestRunId !== undefined) {
        this.modelsByRun.delete(oldestRunId);
        this.sessionsByRun.delete(oldestRunId);
      }
    }
    this.modelsByRun.set(call.runId, call.model);
    if (call.sessionKey !== undefined) {
      if (
        !this.modelsBySession.has(call.sessionKey) &&
        this.modelsBySession.size >= MAX_TRACKED_SESSIONS
      ) {
        const oldestSessionKey = this.modelsBySession.keys().next().value;
        if (oldestSessionKey !== undefined) {
          this.evictSession(oldestSessionKey);
        }
      }
      this.modelsBySession.set(call.sessionKey, call.model);
      this.sessionsByRun.set(call.runId, call.sessionKey);
    }
  }

  resolve(context: AttributionContext): string | undefined {
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

  endSession(sessionKey: string | undefined): void {
    if (sessionKey === undefined) {
      return;
    }
    this.evictSession(sessionKey);
  }

  private evictSession(sessionKey: string): void {
    this.modelsBySession.delete(sessionKey);
    for (const [runId, runSessionKey] of this.sessionsByRun) {
      if (runSessionKey === sessionKey) {
        this.modelsByRun.delete(runId);
        this.sessionsByRun.delete(runId);
      }
    }
  }

  clear(): void {
    this.modelsByRun.clear();
    this.modelsBySession.clear();
    this.sessionsByRun.clear();
  }
}
