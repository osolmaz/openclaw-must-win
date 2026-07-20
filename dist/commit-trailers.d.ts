export type CommitTrailers = {
    coAuthor: string;
    generatedBy: string;
};
export declare function buildCommitTrailers(model: string, openClawVersion: string): CommitTrailers;
export declare function createCommitHookDirectory(): string;
export declare function removeCommitHookDirectory(hooksDirectory: string | undefined): void;
export declare function wrapExecCommand(command: string, hooksDirectory: string, model: string, openClawVersion: string, environment?: NodeJS.ProcessEnv): string;
//# sourceMappingURL=commit-trailers.d.ts.map