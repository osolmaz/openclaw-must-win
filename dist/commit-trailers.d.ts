export type CommitTrailers = {
    coAuthor: string;
    generatedBy: string;
};
export declare function buildCommitTrailers(model: string, openClawVersion: string): CommitTrailers;
export declare function applyCommitTrailers(messageFile: string, model: string, openClawVersion: string, gitExecutable?: string): void;
//# sourceMappingURL=commit-trailers.d.ts.map