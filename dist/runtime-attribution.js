import { AttributionContextStore, } from "./context-store.js";
import { resolveConfiguredModel } from "./configured-model.js";
import { ModelAttribution } from "./model-attribution.js";
import { resolveAttributionPaths } from "./paths.js";
import { readProcessIdentity } from "./process-origin.js";
const GATEWAY_REFRESH_INTERVAL_MS = 60_000;
export class RuntimeAttribution {
    api;
    gateway;
    models = new ModelAttribution();
    refreshTimer;
    store;
    constructor(api) {
        this.api = api;
    }
    register() {
        this.api.on("gateway_start", () => {
            this.start();
        });
        this.api.on("model_call_started", (event, context) => {
            this.recordModel(event, context.sessionKey);
        });
        this.api.on("before_tool_call", (event, context) => {
            this.beforeTool(event, context);
        });
        this.api.on("after_tool_call", (event, context) => {
            this.afterTool(event, context);
        });
        this.api.on("session_end", (event, context) => {
            this.models.endSession(event.sessionKey ?? context.sessionKey);
        });
        this.api.on("gateway_stop", () => {
            this.stop();
        });
    }
    recordModel(event, contextSessionKey) {
        const sessionKey = event.sessionKey ?? contextSessionKey;
        this.models.record({
            model: event.model,
            provider: event.provider,
            runId: event.runId,
            ...(sessionKey === undefined ? {} : { sessionKey }),
        });
    }
    beforeTool(event, context) {
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
        this.writeCommandTicket(command, model, event, context, runId);
        return undefined;
    }
    ensureStore() {
        if (this.store === undefined || this.gateway === undefined) {
            this.start();
        }
        return this.store !== undefined && this.gateway !== undefined;
    }
    resolveModel(runId, context) {
        const model = this.models.resolve({ runId, sessionKey: context.sessionKey });
        return (model ??
            resolveConfiguredModel({
                ...(context.agentId === undefined ? {} : { agentId: context.agentId }),
                config: this.api.runtime.config.current(),
                ...(context.sessionKey === undefined ? {} : { sessionKey: context.sessionKey }),
            }));
    }
    writeCommandTicket(command, model, event, context, runId) {
        if (this.store === undefined || this.gateway === undefined) {
            return;
        }
        try {
            this.gateway = this.store.refreshGateway(this.gateway);
            this.store.recordTool({
                command,
                gateway: this.gateway,
                model,
                ...(runId === undefined ? {} : { runId }),
                ...(context.sessionKey === undefined ? {} : { sessionKey: context.sessionKey }),
                ...readToolCallId(event, context),
                ...readWorkdir(event.params),
            });
        }
        catch (error) {
            this.api.logger.warn(`openclaw-must-win: could not record execution ticket: ${formatError(error)}`);
            // Required mode is enforced by the Git dispatcher when context is unavailable.
        }
    }
    afterTool(event, context) {
        if (event.toolName !== "exec" || this.store === undefined || this.gateway === undefined) {
            return;
        }
        try {
            this.store.completeTool(event.toolCallId ?? context.toolCallId, this.gateway.gatewayId);
        }
        catch {
            // Expiry pruning handles an incomplete ticket later.
        }
    }
    start() {
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
        }
        catch (error) {
            this.store = undefined;
            this.gateway = undefined;
            this.api.logger.warn(`openclaw-must-win: could not initialize attribution store: ${formatError(error)}`);
        }
    }
    startRefreshTimer() {
        if (this.store === undefined || this.gateway === undefined) {
            return undefined;
        }
        const timer = setInterval(() => {
            this.refreshGateway();
        }, GATEWAY_REFRESH_INTERVAL_MS);
        timer.unref();
        return timer;
    }
    refreshGateway() {
        try {
            if (this.store && this.gateway) {
                this.gateway = this.store.refreshGateway(this.gateway);
            }
        }
        catch {
            // The next tool call retries writes through the same store.
        }
    }
    stop() {
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
    }
}
function readEligibleCommand(event) {
    if (event.toolName !== "exec") {
        return undefined;
    }
    const command = event.params["command"];
    return typeof command === "string" && command.trim() ? command : undefined;
}
function readMode(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return "required";
    }
    return value["mode"] === "best-effort" ? "best-effort" : "required";
}
function readWorkdir(params) {
    const value = params["workdir"] ?? params["cwd"];
    return typeof value === "string" && value.trim() ? { workdir: value } : {};
}
function readToolCallId(event, context) {
    const toolCallId = event.toolCallId ?? context.toolCallId;
    return toolCallId === undefined ? {} : { toolCallId };
}
function formatError(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=runtime-attribution.js.map