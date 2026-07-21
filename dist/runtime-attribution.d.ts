import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
export declare class RuntimeAttribution {
    private readonly api;
    private gateway;
    private readonly models;
    private refreshTimer;
    private store;
    constructor(api: OpenClawPluginApi);
    register(): void;
    private recordModel;
    private beforeTool;
    private ensureStore;
    private resolveModel;
    private writeTicket;
    private afterTool;
    private start;
    private startRefreshTimer;
    private refreshGateway;
    private stop;
}
//# sourceMappingURL=runtime-attribution.d.ts.map