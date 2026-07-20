import type { CommitAttribution } from "./commit-attribution.js";
import type { ModelAttribution } from "./model-attribution.js";
export type ToolCall = {
    params: Record<string, unknown>;
    runId?: string | undefined;
    sessionKey?: string | undefined;
    toolKind?: string | undefined;
    toolName: string;
};
export type ToolCallRewrite = {
    params: Record<string, unknown>;
};
export declare function rewriteExecToolCall(call: ToolCall, models: ModelAttribution, commits: Pick<CommitAttribution, "wrap">, openClawVersion: string): ToolCallRewrite | undefined;
//# sourceMappingURL=tool-attribution.d.ts.map