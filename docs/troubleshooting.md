# Troubleshooting

## Doctor reports missing setup

The OpenClaw plugin and Git dispatcher are installed separately. Run setup from the same package tag
as the plugin, then restart the Gateway:

```bash
npm exec --yes \
  --package=git+https://github.com/osolmaz/openclaw-must-win.git#<tag> \
  -- openclaw-must-win setup
```

Setup must run as the same operating-system user that runs the Gateway and creates commits.

## Repository hooks path overrides the dispatcher

A local `core.hooksPath` prevents Git from invoking the global dispatcher. Inspect it with:

```bash
git config --local --get core.hooksPath
```

Remove the local value if the repository can use its normal `.git/hooks` directory:

```bash
git config --local --unset-all core.hooksPath
```

OpenClaw Must Win delegates hooks from `.git/hooks`. If the repository must keep a custom path, this
external attribution method cannot enforce required mode there.

## Commit refused because context is missing

The Git process matched the Gateway cgroup, but no execution ticket with a matching command digest
identified the model. Check that the plugin is loaded and inspect its diagnostics:

```bash
openclaw plugins inspect openclaw-must-win --runtime --json
```

Restart the Gateway after installing or upgrading the plugin. A custom harness that does not emit
OpenClaw's normalized `before_tool_call` event cannot create tickets and therefore cannot commit in
required mode. A process that has neither an inherited execution ID nor its original command in
`/proc` ancestry is also rejected; use best-effort mode only when that loss of enforcement is
acceptable.

## Commit refused because context is ambiguous

More than one execution ticket with the same command digest matched the commit process. Wait for the
other tool call to finish and retry the commit. Best-effort mode can avoid the refusal, but the
retried commit may have no OpenClaw attribution.

## Terminal commit receives OpenClaw trailers

Run the Gateway as a managed process with its own cgroup. A Gateway launched directly inside an
interactive terminal can share the terminal scope, which removes the process boundary used by the
dispatcher.

Compare the cgroups:

```bash
cat /proc/$$/cgroup
cat /proc/$(pgrep -n -f 'openclaw.*gateway')/cgroup
```

They should differ. Stop an unmanaged Gateway and start it through the existing OpenClaw-managed
installation.

## Existing hooks do not run

Run `openclaw-must-win doctor` and inspect the saved setup state:

```bash
cat "${XDG_STATE_HOME:-$HOME/.local/state}/openclaw-must-win/install.json"
```

Setup saves only the global hooks path that existed when setup ran. If another tool changed
`core.hooksPath` later, uninstall refuses to overwrite it. Restore the intended Git configuration
manually, then rerun setup.

## Removing a broken dispatcher

Use the package CLI so it can restore the saved hooks path:

```bash
npm exec --yes \
  --package=git+https://github.com/osolmaz/openclaw-must-win.git#<tag> \
  -- openclaw-must-win uninstall
```

If the copied runtime is missing and Git cannot commit, read `install.json`, restore its
`previousHooksPath` with `git config --global core.hooksPath`, then remove the OpenClaw Must Win
data and state directories.
