import { existsSync } from "node:fs";
import { join } from "node:path";
import { createCommitHookDirectory, wrapExecCommand } from "./commit-trailers.js";
export class CommitAttribution {
    hooksDirectory;
    wrap(command, model, openClawVersion) {
        if (this.hooksDirectory === undefined ||
            !existsSync(join(this.hooksDirectory, "prepare-commit-msg"))) {
            this.hooksDirectory = createCommitHookDirectory();
        }
        return wrapExecCommand(command, this.hooksDirectory, model, openClawVersion);
    }
}
//# sourceMappingURL=commit-attribution.js.map