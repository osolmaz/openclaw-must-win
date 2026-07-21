import { getSessionEntry } from "openclaw/plugin-sdk/config-runtime";
import { formatModel } from "./model-attribution.js";

type ModelConfig = string | { primary?: string };
type AgentConfig = { id?: string; model?: ModelConfig };
type ConfigShape = {
  agents?: {
    defaults?: { model?: ModelConfig };
    list?: AgentConfig[];
  };
};
type SessionModel = {
  modelOverride?: string;
  providerOverride?: string;
};
type SessionReader = (sessionKey: string, agentId: string | undefined) => SessionModel | undefined;

export function resolveConfiguredModel(
  input: { agentId?: string; config: unknown; sessionKey?: string },
  readEntry: SessionReader = readSession,
): string | undefined {
  const sessionModel = resolveSessionModel(input, readEntry);
  return sessionModel ?? resolveConfigModel(input.config, input.agentId);
}

function resolveSessionModel(
  input: { agentId?: string; sessionKey?: string },
  readEntry: SessionReader,
): string | undefined {
  if (input.sessionKey === undefined) {
    return undefined;
  }
  const session = readEntry(input.sessionKey, input.agentId);
  return session?.modelOverride
    ? formatModel(session.providerOverride, session.modelOverride)
    : undefined;
}

function resolveConfigModel(configValue: unknown, agentId: string | undefined): string | undefined {
  const agents = readAgentsConfig(configValue);
  if (agents === undefined) {
    return undefined;
  }
  const agent = agents.list?.find((entry) => entry.id === agentId);
  return readModel(agent?.model) ?? readModel(agents.defaults?.model);
}

function readAgentsConfig(configValue: unknown): ConfigShape["agents"] {
  return isRecord(configValue) ? (configValue as ConfigShape).agents : undefined;
}

function readSession(sessionKey: string, agentId: string | undefined): SessionModel | undefined {
  try {
    return getSessionEntry({
      ...(agentId === undefined ? {} : { agentId }),
      sessionKey,
    });
  } catch {
    return undefined;
  }
}

function readModel(value: ModelConfig | undefined): string | undefined {
  const model = typeof value === "string" ? value : value?.primary;
  return readNonEmpty(model);
}

function readNonEmpty(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized === "" ? undefined : normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
