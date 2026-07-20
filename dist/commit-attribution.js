import { existsSync } from "node:fs";
import { join } from "node:path";
import { createCommitHookDirectory, wrapExecCommand } from "./commit-trailers.js";
import { hasAttributableGitCommit } from "./git-commit-command.js";
export class CommitAttribution {
    createHooks;
    platform;
    hooksDirectory;
    constructor(createHooks = createCommitHookDirectory, platform = process.platform) {
        this.createHooks = createHooks;
        this.platform = platform;
    }
    wrap(command, model, openClawVersion) {
        if (this.platform === "win32" || !hasAttributableGitCommit(command)) {
            return command;
        }
        try {
            if (this.hooksDirectory === undefined ||
                !existsSync(join(this.hooksDirectory, "prepare-commit-msg"))) {
                this.hooksDirectory = this.createHooks();
            }
            return wrapExecCommand(command, this.hooksDirectory, model, openClawVersion, process.env, this.platform);
        }
        catch {
            return command;
        }
    }
}
//# sourceMappingURL=commit-attribution.js.map