# OpenClaw Must Win

OpenClaw Must Win is a Git commit attribution plugin for OpenClaw. It adds the active model and
OpenClaw version to commits created through the built-in `exec` tool.

A commit made by an OpenClaw agent gets these trailers:

```text
Co-Authored-By: gpt-5.6-sol via OpenClaw <noreply@openclaw.ai>
Generated-By: OpenClaw 2026.6.11
```

The plugin does not change repository or global Git configuration. It uses a temporary Git hook for
each running Gateway, delegates to existing repository hooks, and removes its hook files when the
Gateway stops.

## Requirements

- OpenClaw 2026.6.11 or newer
- Node.js 22.19 or newer
- Git

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
untouched.

The plugin recognizes the model reported by OpenClaw for the active run. If OpenClaw has not
reported a model, it leaves the command unchanged and does not write a co-author.

Existing `prepare-commit-msg` hooks still run. If an existing hook rejects the commit, Git keeps the
same failure behavior.

## License

[MIT](LICENSE)
