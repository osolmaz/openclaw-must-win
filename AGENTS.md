# OpenClaw Must Win

- Build against OpenClaw's documented plugin API. Do not copy third-party plugin implementations.
- Keep Git attribution limited to commits created through OpenClaw's `exec` tool.
- Preserve OpenClaw's shell allowlist analysis when changing command rewriting.
- Do not persist Git configuration or replace repository hooks without delegating to them.
- Use strict TypeScript and add tests for every behavior change.
- Avoid runtime dependencies when Node.js and OpenClaw APIs are sufficient.
- Before finishing, run `npm run check`. Run `npm run mutate` separately, then run
  `git diff --check`.
