export const GIT_HOOK_NAMES = [
  "applypatch-msg",
  "commit-msg",
  "fsmonitor-watchman",
  "post-applypatch",
  "post-checkout",
  "post-commit",
  "post-index-change",
  "post-merge",
  "post-receive",
  "post-rewrite",
  "post-update",
  "p4-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "p4-prepare-changelist",
  "pre-applypatch",
  "pre-auto-gc",
  "pre-commit",
  "pre-merge-commit",
  "pre-push",
  "pre-rebase",
  "pre-receive",
  "prepare-commit-msg",
  "proc-receive",
  "push-to-checkout",
  "reference-transaction",
  "sendemail-validate",
  "update",
] as const;

export type GitHookName = (typeof GIT_HOOK_NAMES)[number];

export function isGitHookName(value: string): value is GitHookName {
  return (GIT_HOOK_NAMES as readonly string[]).includes(value);
}

export function isMessageHook(value: GitHookName): boolean {
  return value === "prepare-commit-msg" || value === "commit-msg";
}
