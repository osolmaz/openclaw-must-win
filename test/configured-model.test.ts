import { describe, expect, it, vi } from "vitest";
import { resolveConfiguredModel } from "../src/configured-model.js";

describe("resolveConfiguredModel", () => {
  it("prefers a session override with provider", () => {
    const readSession = vi.fn(() => ({ modelOverride: "gpt-5.6-sol", providerOverride: "openai" }));
    expect(
      resolveConfiguredModel(
        {
          agentId: "main",
          config: { agents: { defaults: { model: "fallback/model" } } },
          sessionKey: "session",
        },
        readSession,
      ),
    ).toBe("openai/gpt-5.6-sol");
    expect(readSession).toHaveBeenCalledWith("session", "main");
  });

  it("uses agent and default configured models", () => {
    const config = {
      agents: {
        defaults: { model: { primary: "default/model" } },
        list: [{ id: "main", model: "agent/model" }],
      },
    };
    expect(resolveConfiguredModel({ agentId: "main", config })).toBe("agent/model");
    expect(resolveConfiguredModel({ agentId: "other", config })).toBe("default/model");
  });

  it("ignores invalid and empty model config", () => {
    expect(resolveConfiguredModel({ config: null })).toBeUndefined();
    expect(resolveConfiguredModel({ config: null, sessionKey: "missing" })).toBeUndefined();
    expect(
      resolveConfiguredModel({ config: { agents: { defaults: { model: { primary: " " } } } } }),
    ).toBeUndefined();
  });
});
