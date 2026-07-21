# OpenClaw Must Win

- Build against OpenClaw's documented plugin API. Do not copy third-party plugin implementations.
- Attribute commits only when Linux process origin and an OpenClaw execution ticket agree.
- Never change tool parameters, approval policy, or shell allowlist analysis to add attribution.
- Git dispatcher setup must be explicit, reversible, and preserve the previous global hooks path.
- Delegate existing global and repository Git hooks without suppressing their failures.
- Keep runtime context private, bounded, short-lived, and free of full command text.
- Use strict TypeScript and add tests for every behavior change.
- Avoid runtime dependencies when Node.js and OpenClaw APIs are sufficient.
- Before finishing, run `npm run check`. Run `npm run mutate` separately, then run
  `git diff --check`.
