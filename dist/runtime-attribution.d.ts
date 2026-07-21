import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
export declare class RuntimeAttribution {
    private readonly api;
    private gateway;
    private readonly executionIdsByToolCall;
    private readonly models;
    private readonly pendingExecutionIds;
    private refreshTimer;
    private store;
    constructor(api: OpenClawPluginApi);
    register(): void;
    private recordModel;
    private resolveExecEnvironment;
    private enqueueExecutionId;
    private consumeExecutionId;
    private beforeTool;
    private trackExecutionForToolCall;
    private ensureStore;
    private resolveModel;
    private writeExecutionTicket;
    private writeCommandTicket;
    private afterTool;
    private completeToolExecution;
    private start;
    private startRefreshTimer;
    private refreshGateway;
    private stop;
}
//# sourceMappingURL=runtime-attribution.d.ts.map