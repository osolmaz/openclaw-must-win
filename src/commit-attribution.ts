import { existsSync } from "node:fs";
import { join } from "node:path";
import { createCommitHookDirectory, wrapExecCommand } from "./commit-trailers.js";
import { hasAttributableGitCommit } from "./git-commit-command.js";

type HookDirectoryFactory = () => string;

export class CommitAttribution {
  private hooksDirectory: string | undefined;

  constructor(
    private readonly createHooks: HookDirectoryFactory = createCommitHookDirectory,
    private readonly platform: NodeJS.Platform = process.platform,
  ) {}

  wrap(command: string, model: string, openClawVersion: string): string {
    if (this.platform === "win32" || !hasAttributableGitCommit(command)) {
      return command;
    }

    try {
      if (
        this.hooksDirectory === undefined ||
        !existsSync(join(this.hooksDirectory, "prepare-commit-msg"))
      ) {
        this.hooksDirectory = this.createHooks();
      }
      return wrapExecCommand(
        command,
        this.hooksDirectory,
        model,
        openClawVersion,
        process.env,
        this.platform,
      );
    } catch {
      return command;
    }
  }
}
