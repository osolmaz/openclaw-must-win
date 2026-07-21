import { randomUUID } from "node:crypto";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk/plugin-entry";
import {
  AttributionContextStore,
  type AttributionMode,
  type GatewayRecord,
} from "./context-store.js";
import { resolveConfiguredModel } from "./configured-model.js";
import { ModelAttribution } from "./model-attribution.js";
import { resolveAttributionPaths } from "./paths.js";
import { EXECUTION_ID_ENV, readProcessIdentity } from "./process-origin.js";

const GATEWAY_REFRESH_INTERVAL_MS = 60_000;
const MAX_PENDING_EXECUTIONS_PER_SESSION = 16;
const MAX_PENDING_SESSIONS = 1_024;

type ToolEvent = {
  params: Record<string, unknown>;
  runId?: string;
  toolCallId?: string;
  toolKind?: string;
  toolName: string;
};
type ToolContext = {
  agentId?: string;
  runId?: string;
  sessionKey?: string;
  toolCallId?: string;
};

export class RuntimeAttribution {
  private gateway: GatewayRecord | undefined;
  private readonly models = new ModelAttribution();
  private readonly pendingExecutionIds = new Map<string, string[]>();
  private refreshTimer: NodeJS.Timeout | undefined;
  private store: AttributionContextStore | undefined;

  constructor(private readonly api: OpenClawPluginApi) {}

  register(): void {
    this.api.on("gateway_start", () => {
      this.start();
    });
    this.api.on("model_call_started", (event, context) => {
      this.recordModel(event, context.sessionKey);
    });
    this.api.on("resolve_exec_env", (event, context) =>
      this.resolveExecEnvironment(event, context),
    );
    this.api.on("before_tool_call", (event, context) => {
      this.beforeTool(event, context);
    });
    this.api.on("after_tool_call", (event, context) => {
      this.afterTool(event, context);
    });
    this.api.on("session_end", (event, context) => {
      const sessionKey = event.sessionKey ?? context.sessionKey;
      this.models.endSession(sessionKey);
      if (sessionKey !== undefined) {
        this.pendingExecutionIds.delete(sessionKey);
      }
    });
    this.api.on("gateway_stop", () => {
      this.stop();
    });
  }

  private recordModel(
    event: { model: string; provider: string; runId: string; sessionKey?: string },
    contextSessionKey: string | undefined,
  ): void {
    const sessionKey = event.sessionKey ?? contextSessionKey;
    this.models.record({
      model: event.model,
      provider: event.provider,
      runId: event.runId,
      ...(sessionKey === undefined ? {} : { sessionKey }),
    });
  }

  private resolveExecEnvironment(
    event: { host: "gateway" | "node" | "sandbox"; sessionKey?: string },
    context: ToolContext,
  ): Record<string, string> | undefined {
    const sessionKey = event.sessionKey ?? context.sessionKey;
    if (process.platform !== "linux" || event.host !== "gateway" || sessionKey === undefined) {
      return undefined;
    }
    const executionId = randomUUID();
    this.enqueueExecutionId(sessionKey, executionId);
    return { [EXECUTION_ID_ENV]: executionId };
  }

  private enqueueExecutionId(sessionKey: string, executionId: string): void {
    let pending = this.pendingExecutionIds.get(sessionKey);
    if (pending === undefined) {
      if (this.pendingExecutionIds.size >= MAX_PENDING_SESSIONS) {
        const oldestSessionKey = this.pendingExecutionIds.keys().next().value;
        if (oldestSessionKey !== undefined) {
          this.pendingExecutionIds.delete(oldestSessionKey);
        }
      }
      pending = [];
      this.pendingExecutionIds.set(sessionKey, pending);
    }
    pending.push(executionId);
    if (pending.length > MAX_PENDING_EXECUTIONS_PER_SESSION) {
      pending.shift();
    }
  }

  private consumeExecutionId(sessionKey: string | undefined): string | undefined {
    if (sessionKey === undefined) {
      return undefined;
    }
    const pending = this.pendingExecutionIds.get(sessionKey);
    const executionId = pending?.shift();
    if (pending?.length === 0) {
      this.pendingExecutionIds.delete(sessionKey);
    }
    return executionId;
  }

  private beforeTool(event: ToolEvent, context: ToolContext): undefined {
    const command = readEligibleCommand(event);
    if (command === undefined) {
      if (event.toolName === "exec") {
        this.api.logger.warn("openclaw-must-win: exec call has no command to attribute");
      }
      return undefined;
    }
    if (!this.ensureStore()) {
      this.api.logger.warn("openclaw-must-win: attribution store is unavailable");
      return undefined;
    }
    const runId = event.runId ?? context.runId;
    const model = this.resolveModel(runId, context);
    if (model === undefined) {
      this.api.logger.warn("openclaw-must-win: active model is unavailable");
      return undefined;
    }
    this.writeTicket(
      command,
      model,
      event,
      context,
      runId,
      this.consumeExecutionId(context.sessionKey),
    );
    return undefined;
  }

  private ensureStore(): boolean {
    if (this.store === undefined || this.gateway === undefined) {
      this.start();
    }
    return this.store !== undefined && this.gateway !== undefined;
  }

  private resolveModel(runId: string | undefined, context: ToolContext): string | undefined {
    const model = this.models.resolve({ runId, sessionKey: context.sessionKey });
    return (
      model ??
      resolveConfiguredModel({
        ...(context.agentId === undefined ? {} : { agentId: context.agentId }),
        config: this.api.runtime.config.current(),
        ...(context.sessionKey === undefined ? {} : { sessionKey: context.sessionKey }),
      })
    );
  }

  private writeTicket(
    command: string,
    model: string,
    event: ToolEvent,
    context: ToolContext,
    runId: string | undefined,
    executionId: string | undefined,
  ): void {
    if (this.store === undefined || this.gateway === undefined) {
      return;
    }
    try {
      this.gateway = this.store.refreshGateway(this.gateway);
      this.store.recordTool({
        command,
        ...(executionId === undefined ? {} : { executionId }),
        gateway: this.gateway,
        model,
        ...(runId === undefined ? {} : { runId }),
        ...(context.sessionKey === undefined ? {} : { sessionKey: context.sessionKey }),
        ...readToolCallId(event, context),
        ...readWorkdir(event.params),
      });
    } catch (error) {
      this.api.logger.warn(
        `openclaw-must-win: could not record execution ticket: ${formatError(error)}`,
      );
      // Required mode is enforced by the Git dispatcher when context is unavailable.
    }
  }

  private afterTool(event: ToolEvent, context: ToolContext): void {
    if (event.toolName !== "exec" || this.store === undefined || this.gateway === undefined) {
      return;
    }
    try {
      this.store.completeTool(event.toolCallId ?? context.toolCallId, this.gateway.gatewayId);
    } catch {
      // Expiry pruning handles an incomplete ticket later.
    }
  }

  private start(): void {
    if (this.store !== undefined && this.gateway !== undefined) {
      return;
    }
    const identity = process.platform === "linux" ? readProcessIdentity() : undefined;
    if (identity === undefined) {
      return;
    }
    try {
      const store = new AttributionContextStore(resolveAttributionPaths());
      const gateway = store.registerGateway({
        identity,
        mode: readMode(this.api.pluginConfig),
        openClawVersion: this.api.runtime.version,
      });
      this.store = store;
      this.gateway = gateway;
      this.refreshTimer = this.startRefreshTimer();
    } catch (error) {
      this.store = undefined;
      this.gateway = undefined;
      this.api.logger.warn(
        `openclaw-must-win: could not initialize attribution store: ${formatError(error)}`,
      );
    }
  }

  private startRefreshTimer(): NodeJS.Timeout | undefined {
    if (this.store === undefined || this.gateway === undefined) {
      return undefined;
    }
    const timer = setInterval(() => {
      this.refreshGateway();
    }, GATEWAY_REFRESH_INTERVAL_MS);
    timer.unref();
    return timer;
  }

  private refreshGateway(): void {
    try {
      if (this.store && this.gateway) {
        this.gateway = this.store.refreshGateway(this.gateway);
      }
    } catch {
      // The next tool call retries writes through the same store.
    }
  }

  private stop(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    if (this.store && this.gateway) {
      this.store.unregisterGateway(this.gateway.gatewayId);
    }
    this.gateway = undefined;
    this.store = undefined;
    this.models.clear();
    this.pendingExecutionIds.clear();
  }
}

function readEligibleCommand(event: ToolEvent): string | undefined {
  if (event.toolName !== "exec") {
    return undefined;
  }
  const command = event.params["command"];
  return typeof command === "string" && command.trim() ? command : undefined;
}

function readMode(value: unknown): AttributionMode {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return "required";
  }
  return (value as Record<string, unknown>)["mode"] === "best-effort" ? "best-effort" : "required";
}

function readWorkdir(params: Record<string, unknown>): { workdir?: string } {
  const value = params["workdir"] ?? params["cwd"];
  return typeof value === "string" && value.trim() ? { workdir: value } : {};
}

function readToolCallId(event: ToolEvent, context: ToolContext): { toolCallId?: string } {
  const toolCallId = event.toolCallId ?? context.toolCallId;
  return toolCallId === undefined ? {} : { toolCallId };
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
