import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
export type ApprovalPolicy = {
    ask: "always" | "off" | "on-miss";
    security: "allowlist" | "deny" | "full";
};
export type ExecAttributionPolicyInput = {
    agentId?: string | undefined;
    approvalPolicy: ApprovalPolicy;
    config: OpenClawConfig;
    params: Record<string, unknown>;
};
export declare function readApprovalPolicy(agentId: string | undefined): ApprovalPolicy;
export declare function canAttributeExec(input: ExecAttributionPolicyInput): boolean;
//# sourceMappingURL=exec-policy.d.ts.map