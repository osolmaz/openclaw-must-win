import { describe, expect, it } from "vitest";
import { ModelAttribution } from "../src/model-attribution.js";

describe("ModelAttribution", () => {
  it("resolves the current model by run before session", () => {
    const models = new ModelAttribution();
    models.record({ model: "model-a", runId: "run-a", sessionKey: "session" });
    models.record({ model: "model-b", runId: "run-b", sessionKey: "session" });
    models.record({ model: "model-a-updated", runId: "run-a" });

    expect(models.resolve({ runId: "run-a", sessionKey: "session" })).toBe("model-a-updated");
    expect(models.resolve({ runId: "run-b", sessionKey: "session" })).toBe("model-b");
    expect(models.resolve({ runId: "missing", sessionKey: "session" })).toBe("model-b");
  });

  it("retains multiple sessions below the limit", () => {
    const models = new ModelAttribution();
    models.record({ model: "model-a", runId: "run-a", sessionKey: "session-a" });
    models.record({ model: "model-b", runId: "run-b", sessionKey: "session-b" });

    expect(models.resolve({ sessionKey: "session-a" })).toBe("model-a");
    expect(models.resolve({ sessionKey: "session-b" })).toBe("model-b");
  });

  it("supports calls without a session and bounds retained runs", () => {
    const models = new ModelAttribution();
    models.record({ model: "model-a", runId: "oldest" });
    for (let index = 0; index < 1_024; index += 1) {
      const suffix = String(index);
      models.record({ model: `model-${suffix}`, runId: `run-${suffix}` });
    }

    expect(models.resolve({ runId: "oldest" })).toBeUndefined();
    expect(models.resolve({ runId: "run-1023" })).toBe("model-1023");
  });

  it("bounds retained sessions and removes their run links", () => {
    const models = new ModelAttribution();
    models.record({ model: "old", runId: "old-run", sessionKey: "old-session" });
    for (let index = 0; index < 1_023; index += 1) {
      const suffix = String(index);
      models.record({
        model: `model-${suffix}`,
        runId: `run-${suffix}`,
        sessionKey: `session-${suffix}`,
      });
    }
    models.record({ model: "fresh", runId: "old-run", sessionKey: "old-session" });
    expect(models.resolve({ runId: "old-run" })).toBe("fresh");

    models.record({ model: "new", runId: "new-run", sessionKey: "new-session" });

    expect(models.resolve({ sessionKey: "old-session" })).toBeUndefined();
    expect(models.resolve({ runId: "old-run" })).toBeUndefined();
    expect(models.resolve({ sessionKey: "new-session" })).toBe("new");
  });

  it("clears session and gateway state", () => {
    const models = new ModelAttribution();
    models.record({ model: "model-a", runId: "run-a", sessionKey: "session-a" });
    models.record({ model: "model-b", runId: "run-b", sessionKey: "session-b" });

    models.endSession("session-a");
    expect(models.resolve({ runId: "run-a" })).toBeUndefined();
    expect(models.resolve({ sessionKey: "session-a" })).toBeUndefined();
    expect(models.resolve({ runId: "run-b" })).toBe("model-b");
    expect(models.resolve({ runId: "run-b", sessionKey: "session-b" })).toBe("model-b");
    expect(() => {
      models.endSession(undefined);
    }).not.toThrow();

    models.clear();
    expect(models.resolve({ runId: "run-b", sessionKey: "session-b" })).toBeUndefined();
    expect(models.resolve({})).toBeUndefined();
  });
});
