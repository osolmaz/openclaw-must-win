# Design

OpenClaw Must Win connects OpenClaw's existing tool lifecycle to Git's existing hook lifecycle.
OpenClaw core and agent harnesses remain unchanged.

## Runtime records

The plugin registers the Gateway process when its lifecycle starts. OpenClaw can also instantiate
plugins in an agent-runtime registry that does not receive `gateway_start`, so the plugin performs
the same idempotent initialization before that registry's first `exec` call. The record contains the
Linux cgroup, boot ID, process ID, OpenClaw version, and enforcement mode. A one-minute heartbeat
keeps the record current.

Each normalized `exec` call creates an execution ticket before the command starts. The ticket
records the model, run and session identifiers, tool-call identifier, working-directory hint, and a
SHA-256 digest of the command. Full command text is not written. `after_tool_call` marks the ticket
complete and retains it for 30 minutes so a background commit can still be attributed.

Files live under `$XDG_RUNTIME_DIR/openclaw-must-win` with user-only permissions. Writes use a
temporary file and atomic rename. Expired records are removed during normal plugin and hook
activity, and the ticket count is bounded.

## Process matching

A Git hook reads its own cgroup and boot ID from `/proc`. Terminal processes normally run in a
different scope from the managed Gateway, so they do not match its records.

For a matching Gateway cgroup, the hook hashes command-line arguments from its process ancestry. It
prefers one active ticket whose command digest appears in that ancestry. If no digest matches, it
can select the sole active or retained ticket for the cgroup. Multiple possible tickets are
ambiguous.

Required mode stops message hooks when an OpenClaw process has no unique ticket. Best-effort mode
delegates existing hooks and continues without attribution. A process outside every registered
Gateway cgroup is treated as a terminal process.

## Git dispatcher

`openclaw-must-win setup` installs a dispatcher under `$XDG_DATA_HOME/openclaw-must-win` and points
the user's global `core.hooksPath` at it. The command copies the compiled runtime into that
directory, so npm cache cleanup or plugin removal does not leave Git calling a transient package
path.

The setup state stores the previous global hooks path. For each Git hook, the dispatcher runs the
corresponding hook from that saved path and the repository's default `.git/hooks` directory.
Duplicate paths are skipped, and any hook failure is returned to Git.

`prepare-commit-msg` and `commit-msg` apply trailers after delegated hooks finish. Reapplying the
trailers is idempotent. A later model can amend a commit and add its own co-author while
`Generated-By` is replaced with the current OpenClaw version.

A repository-level `core.hooksPath` takes precedence over the global dispatcher. `doctor` reports
that condition for the current repository. Commands that set `core.hooksPath` on the Git command
line can also bypass the dispatcher.

## Trust boundary

The cgroup check answers whether a process belongs to the Gateway's execution scope. The ticket
answers which OpenClaw run and model were active. Both records belong to the same operating-system
user as the Gateway and Git process.

This design prevents accidental attribution of normal terminal work and catches Git inside nested
scripts without parsing shell syntax. It does not defend against a process that already controls the
user's account. The commit trailers remain editable metadata and carry no signature.
