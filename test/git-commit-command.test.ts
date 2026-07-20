import { describe, expect, it } from "vitest";
import { prefixGitCommitCommands } from "../src/git-commit-command.js";

const PREFIX = "ATTR=1 ";

describe("prefixGitCommitCommands", () => {
  it.each([
    ["git commit -m test", "ATTR=1 git commit -m test"],
    ["/usr/bin/git commit --amend", "ATTR=1 /usr/bin/git commit --amend"],
    ["FOO=bar git commit -m test", "FOO=bar ATTR=1 git commit -m test"],
    ["git -C repo commit -m test", "ATTR=1 git -C repo commit -m test"],
    ["git --git-dir .git commit", "ATTR=1 git --git-dir .git commit"],
    ["git --no-pager commit", "ATTR=1 git --no-pager commit"],
    ["git -- commit", "ATTR=1 git -- commit"],
    [
      "echo one && git add a; git commit -m test\ngit status",
      "echo one && git add a; ATTR=1 git commit -m test\ngit status",
    ],
    [
      "git commit -m one && git commit -m two",
      "ATTR=1 git commit -m one && ATTR=1 git commit -m two",
    ],
  ])("prefixes direct commit command %s", (command, expected) => {
    expect(prefixGitCommitCommands(command, PREFIX)).toBe(expected);
  });

  it.each([
    "git status",
    "echo git commit",
    "echo 'git commit -m quoted'",
    'echo "git commit -m quoted"',
    "sh -c 'git commit -m nested'",
    "$(command -v git) commit -m dynamic",
    "GIT_CONFIG_COUNT=2 git commit -m configured",
    "GIT_CONFIG_KEY_0=x git commit -m configured",
    "git -c core.hooksPath=custom-hooks commit -m configured",
    "git -ccore.hooksPath=custom-hooks commit -m configured",
    "git --config-env=core.hooksPath=HOOKS commit -m configured",
    "# git commit -m comment",
    "git commitish -m nope",
  ])("leaves unsupported or non-commit command unchanged: %s", (command) => {
    expect(prefixGitCommitCommands(command, PREFIX)).toBe(command);
  });

  it("ignores control operators inside quotes and escaped separators", () => {
    const command = "printf '%s' 'a && git commit' && echo a\\;b && git commit -m real";
    expect(prefixGitCommitCommands(command, PREFIX)).toBe(
      "printf '%s' 'a && git commit' && echo a\\;b && ATTR=1 git commit -m real",
    );
  });

  it("does not rewrite here-document or here-string contents", () => {
    const heredoc = "cat <<'EOF'\ngit commit -m not-a-command\nEOF\ngit commit -m later";
    expect(prefixGitCommitCommands(heredoc, PREFIX)).toBe(heredoc);

    const hereString = "cat <<< 'git commit -m data'; git commit -m later";
    expect(prefixGitCommitCommands(hereString, PREFIX)).toBe(hereString);

    const quotedOperator = "echo '<<' && git commit -m real";
    expect(prefixGitCommitCommands(quotedOperator, PREFIX)).toBe(
      "echo '<<' && ATTR=1 git commit -m real",
    );
  });

  it("does not treat an unterminated quoted token as a command", () => {
    const command = "echo ok && 'git commit -m broken";
    expect(prefixGitCommitCommands(command, PREFIX)).toBe(command);
  });
});
