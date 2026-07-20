import { createCommitHookDirectory, wrapExecCommand } from "./commit-trailers.js";
export class CommitAttribution {
    hooksDirectory;
    wrap(command, model, openClawVersion) {
        this.hooksDirectory ??= createCommitHookDirectory();
        return wrapExecCommand(command, this.hooksDirectory, model, openClawVersion);
    }
}
//# sourceMappingURL=commit-attribution.js.map