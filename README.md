# OpenClaw Must Win

OpenClaw Must Win is a Git commit attribution plugin for OpenClaw. It adds the active model and
OpenClaw version to commits created through the built-in `exec` tool.

A commit made by an OpenClaw agent gets these trailers:

```text
Co-Authored-By: gpt-5.6-sol via OpenClaw <noreply@openclaw.ai>
Generated-By: OpenClaw 2026.6.11
```

The plugin does not change repository or global Git configuration. It uses a temporary Git hook for
each running Gateway and delegates to existing repository hooks. The temporary hook stays in the
operating system's temporary directory so delayed background commands can still use it after a
Gateway restart. Normal temporary-file cleanup removes it later.

## Requirements

- OpenClaw 2026.6.11 or newer
- Node.js 22.19 or newer
- Git
- A POSIX Gateway host such as Linux or macOS

Attribution requires the Gateway exec host with `security: "full"` and `ask: "off"` in both OpenClaw
config and the local exec approvals file. The plugin leaves commands unchanged in allowlist,
approval-required, sandbox, node, and automatic host modes.

## Install

Choose a tag from the [releases page](https://github.com/osolmaz/openclaw-must-win/releases), then
install and inspect the plugin:

```bash
openclaw plugins install git:github.com/osolmaz/openclaw-must-win@<tag>
openclaw plugins enable openclaw-must-win
openclaw plugins inspect openclaw-must-win --runtime --json
```

A managed Gateway normally restarts after installation. Restart an unmanaged Gateway before using
the plugin.

For local development, build the package and link the checkout:

```bash
npm ci
npm run build
openclaw plugins install --link /path/to/openclaw-must-win
openclaw plugins inspect openclaw-must-win --runtime --json
```

## Scope

Attribution applies only when Git runs inside OpenClaw's `exec` tool. Commits made in another
terminal are untouched. A separate agent harness that runs Git outside `exec` also remains
untouched. Commands on Windows Gateways are currently left unchanged rather than rewritten with
POSIX shell syntax.

The plugin recognizes direct `git commit` commands, including commands in shell chains and calls
through an absolute Git path. It does not rewrite nested shell strings or dynamic command names.
Commands that set `core.hooksPath` with a Git command-line option or supply process-local Git
configuration through the exec environment or shell assignments are also left unchanged. These
limits keep OpenClaw's approval analysis focused on the original Git command. Restrictive exec
policies and per-call approval requests are never weakened or made noisier to add attribution.

The plugin recognizes the model reported by OpenClaw for the active run. If OpenClaw has not
reported a model, it leaves the command unchanged and does not write a co-author.

Existing Git hooks still run. Message hooks run before attribution is finalized, so their edits are
preserved without allowing them to erase the trailers. If an existing hook rejects the commit, Git
keeps the same failure behavior.

## License

[MIT](LICENSE)
