import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { getSessionEntry } from "openclaw/plugin-sdk/config-runtime";
type ExecLayer = {
    ask?: "always" | "off" | "on-miss";
    host?: "auto" | "gateway" | "node" | "sandbox";
    mode?: "allowlist" | "ask" | "auto" | "deny" | "full";
    security?: "allowlist" | "deny" | "full";
};
export type ApprovalPolicy = {
    ask: "always" | "off" | "on-miss";
    security: "allowlist" | "deny" | "full";
};
export type ExecAttributionPolicyInput = {
    agentId?: string | undefined;
    approvalPolicy: ApprovalPolicy;
    config: OpenClawConfig;
    params: Record<string, unknown>;
    sessionExec: ExecLayer | null | undefined;
};
export declare function readApprovalPolicy(agentId: string | undefined): ApprovalPolicy;
type SessionStoreRuntime = {
    get: typeof getSessionEntry;
};
export declare function readSessionExecLayer(sessionKey: string | undefined, agentId: string | undefined, runtime?: SessionStoreRuntime): ExecLayer | null | undefined;
export declare function canAttributeExec(input: ExecAttributionPolicyInput): boolean;
export {};
//# sourceMappingURL=exec-policy.d.ts.map