import type { AttributionPaths } from "./paths.js";
import { type ProcessSnapshot } from "./process-origin.js";
export type AttributionMode = "best-effort" | "required";
export type GatewayRecord = {
    bootId: string;
    cgroup: string;
    expiresAt: number;
    gatewayId: string;
    mode: AttributionMode;
    openClawVersion: string;
    pid: number;
    schemaVersion: 1;
};
export type ExecutionTicket = {
    bootId: string;
    cgroup: string;
    commandHash: string;
    completedAt?: number;
    expiresAt: number;
    gatewayId: string;
    mode: AttributionMode;
    model: string;
    openClawVersion: string;
    runId?: string;
    schemaVersion: 1;
    sessionKey?: string;
    startedAt: number;
    ticketId: string;
    toolCallId?: string;
    workdir?: string;
};
export type AttributionResolution = {
    origin: "terminal";
} | {
    mode: AttributionMode;
    origin: "openclaw";
    reason: "ambiguous" | "missing";
} | {
    origin: "openclaw";
    ticket: ExecutionTicket;
};
export declare class AttributionContextStore {
    private readonly paths;
    private readonly now;
    private readonly gatewaysDirectory;
    private readonly ticketsDirectory;
    constructor(paths: AttributionPaths, now?: () => number);
    registerGateway(input: {
        identity: {
            bootId: string;
            cgroup: string;
        };
        mode: AttributionMode;
        openClawVersion: string;
        pid?: number;
    }): GatewayRecord;
    refreshGateway(record: GatewayRecord): GatewayRecord;
    unregisterGateway(gatewayId: string): void;
    recordTool(input: {
        command: string;
        gateway: GatewayRecord;
        model: string;
        runId?: string;
        sessionKey?: string;
        toolCallId?: string;
        workdir?: string;
    }): ExecutionTicket;
    completeTool(toolCallId: string | undefined, gatewayId: string): void;
    resolve(snapshot: ProcessSnapshot): AttributionResolution;
    prune(): void;
    private readGateways;
    private readTickets;
    private readGateway;
    private readTicket;
    private readJson;
    private listJsonFiles;
    private writeRecord;
}
//# sourceMappingURL=context-store.d.ts.map