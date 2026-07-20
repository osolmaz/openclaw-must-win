export default {
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  mutate: [
    "src/commit-attribution.ts",
    "src/commit-trailers.ts",
    "src/model-attribution.ts",
    "src/tool-attribution.ts",
  ],
  reporters: ["clear-text", "progress"],
  testRunner: "vitest",
  thresholds: {
    break: 90,
    high: 95,
    low: 90,
  },
  tsconfigFile: "tsconfig.json",
};
