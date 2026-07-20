import { createCommitHookDirectory, wrapExecCommand } from "./commit-trailers.js";

export class CommitAttribution {
  private hooksDirectory: string | undefined;

  wrap(command: string, model: string, openClawVersion: string): string {
    this.hooksDirectory ??= createCommitHookDirectory();
    return wrapExecCommand(command, this.hooksDirectory, model, openClawVersion);
  }
}
