import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      include: [
        "src/commit-attribution.ts",
        "src/commit-trailers.ts",
        "src/exec-policy.ts",
        "src/git-commit-command.ts",
        "src/model-attribution.ts",
        "src/tool-attribution.ts",
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
