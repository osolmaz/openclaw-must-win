export type AttributionPaths = {
    dataDirectory: string;
    hooksDirectory: string;
    installStatePath: string;
    runtimeDirectory: string;
    runtimeFilesDirectory: string;
    stateDirectory: string;
};
export declare function resolveAttributionPaths(environment?: NodeJS.ProcessEnv, homeDirectory?: string, uid?: number | undefined | null): AttributionPaths;
//# sourceMappingURL=paths.d.ts.map