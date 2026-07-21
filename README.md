# OpenClaw Must Win

OpenClaw Must Win is a Git commit attribution plugin for OpenClaw on Linux. It adds the active model
and OpenClaw version to normal Git commits created by Gateway-owned processes, including Codex Bash,
built-in `exec`, and nested scripts.

An attributed commit contains these trailers:

```text
Co-Authored-By: openai/gpt-5.6-sol via OpenClaw <noreply@openclaw.ai>
Generated-By: OpenClaw 2026.6.11
```

The normal Git author and committer stay unchanged. Commits from unrelated terminal processes do not
receive OpenClaw trailers.

## Requirements

- OpenClaw 2026.6.11 or newer
- Node.js 22.19 or newer
- Git
- Linux with `/proc` and cgroup v2
- A managed Gateway running in its own cgroup

## Install

Choose a tag from the [releases page](https://github.com/osolmaz/openclaw-must-win/releases).
Install the plugin, then install the user-level Git dispatcher from the same tag:

```bash
openclaw plugins install git:github.com/osolmaz/openclaw-must-win@<tag>
openclaw plugins enable openclaw-must-win

npm exec --yes \
  --package=git+https://github.com/osolmaz/openclaw-must-win.git#<tag> \
  -- openclaw-must-win setup

npm exec --yes \
  --package=git+https://github.com/osolmaz/openclaw-must-win.git#<tag> \
  -- openclaw-must-win doctor
```

Restart the Gateway after installation. Run `setup` again after upgrading so the copied Git
dispatcher matches the installed plugin.

For a local checkout:

```bash
npm ci
npm run build
node dist/cli.js setup
node dist/cli.js doctor
openclaw plugins install --link /path/to/openclaw-must-win
```

Setup changes the current user's global `core.hooksPath`. It saves the previous value and delegates
to those hooks. Repository hooks under `.git/hooks` also continue to run.

## Operation

The plugin writes short-lived execution tickets under the user's runtime directory. Tickets contain
a random execution ID, a command digest, and attribution metadata, never the full command or
conversation. Built-in Gateway execution carries the random ID in its child environment. The Git
dispatcher compares each commit process with the Gateway cgroup and requires a matching execution ID
or complete command digest before selecting its ticket.

Required mode is the default. It rejects a commit from the Gateway cgroup when attribution is
missing or ambiguous. Best-effort mode lets that commit continue without OpenClaw trailers:

```json
{
  "plugins": {
    "entries": {
      "openclaw-must-win": {
        "config": {
          "mode": "best-effort"
        }
      }
    }
  }
}
```

Use `doctor` inside a repository before agent work. It reports a repository-level `core.hooksPath`,
which would override the dispatcher.

## Uninstall

Remove the dispatcher before removing the plugin:

```bash
npm exec --yes \
  --package=git+https://github.com/osolmaz/openclaw-must-win.git#<tag> \
  -- openclaw-must-win uninstall
openclaw plugins disable openclaw-must-win
```

Uninstall restores the saved global `core.hooksPath`. It refuses to overwrite Git configuration that
changed after setup.

## Limits

This package records attribution for normal `git commit` operations that run Git hooks. Commands
such as `git commit-tree` do not run commit hooks. A command or repository that explicitly replaces
`core.hooksPath` can bypass the dispatcher.

Cgroup matching separates a managed Gateway from ordinary terminal scopes. An unmanaged Gateway
started in the same cgroup as an interactive shell cannot provide that separation. The dispatcher
fails closed only when it can identify the process as OpenClaw-owned.

The trailers are attribution metadata. They are not cryptographic proof, and another process running
as the same operating-system user can alter the runtime files or commit message.

See [Design](docs/design.md) for the matching and hook-delegation model. See
[Troubleshooting](docs/troubleshooting.md) for setup and commit failures.

## License

[MIT](LICENSE)
