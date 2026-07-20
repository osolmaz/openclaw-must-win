import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { CommitAttribution } from "./commit-attribution.js";
import { canAttributeExec, readApprovalPolicy, readSessionExecLayer } from "./exec-policy.js";
import { ModelAttribution } from "./model-attribution.js";
import { rewriteExecToolCall } from "./tool-attribution.js";

const plugin: ReturnType<typeof definePluginEntry> = definePluginEntry({
  id: "openclaw-must-win",
  name: "OpenClaw Must Win",
  description: "Attribute Git commits to the active model and OpenClaw runtime.",
  register(api) {
    const commits = new CommitAttribution();
    const models = new ModelAttribution();

    api.on("model_call_started", (event, context) => {
      const sessionKey = event.sessionKey ?? context.sessionKey;
      models.record({
        model: event.model,
        runId: event.runId,
        ...(sessionKey === undefined ? {} : { sessionKey }),
      });
    });

    api.on("before_tool_call", (event, context) => {
      if (
        event.toolName !== "exec" ||
        event.toolKind === "code_mode_exec" ||
        !canAttributeExec({
          agentId: context.agentId,
          approvalPolicy: readApprovalPolicy(context.agentId),
          config: api.runtime.config.current(),
          params: event.params,
          sessionExec: readSessionExecLayer(context.sessionKey, context.agentId),
        })
      ) {
        return undefined;
      }
      const runId = event.runId ?? context.runId;
      return rewriteExecToolCall(
        {
          params: event.params,
          ...(runId === undefined ? {} : { runId }),
          ...(context.sessionKey === undefined ? {} : { sessionKey: context.sessionKey }),
          toolName: event.toolName,
        },
        models,
        commits,
        api.runtime.version,
      );
    });

    api.on("session_end", (event, context) => {
      models.endSession(event.sessionKey ?? context.sessionKey);
    });

    api.on("gateway_stop", () => {
      models.clear();
    });
  },
});

export default plugin;
