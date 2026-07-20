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

export function rewriteExecToolCall(
  call: ToolCall,
  models: ModelAttribution,
  commits: Pick<CommitAttribution, "wrap">,
  openClawVersion: string,
): ToolCallRewrite | undefined {
  if (call.toolName !== "exec" || call.toolKind === "code_mode_exec") {
    return undefined;
  }

  const command = call.params["command"];
  if (typeof command !== "string" || hasGitConfigEnvironment(call.params["env"])) {
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

function hasGitConfigEnvironment(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return Object.keys(value).some(
    (key) =>
      key === "GIT_CONFIG_COUNT" ||
      key === "GIT_CONFIG_PARAMETERS" ||
      key.startsWith("GIT_CONFIG_KEY_") ||
      key.startsWith("GIT_CONFIG_VALUE_"),
  );
}
