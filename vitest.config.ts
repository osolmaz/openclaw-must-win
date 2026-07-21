import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "src/commit-trailers.ts",
        "src/configured-model.ts",
        "src/context-store.ts",
        "src/git-hook-runner.ts",
        "src/git-hooks.ts",
        "src/installer.ts",
        "src/model-attribution.ts",
        "src/paths.ts",
        "src/process-origin.ts",
      ],
      provider: "v8",
      reporter: ["text", "json", "json-summary"],
      thresholds: {
        branches: 90,
        functions: 90,
        lines: 90,
        statements: 90,
      },
    },
    include: ["test/**/*.test.ts"],
  },
});
