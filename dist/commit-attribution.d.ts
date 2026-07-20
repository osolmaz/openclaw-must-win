type HookDirectoryFactory = () => string;
export declare class CommitAttribution {
    private readonly createHooks;
    private readonly platform;
    private hooksDirectory;
    constructor(createHooks?: HookDirectoryFactory, platform?: NodeJS.Platform);
    wrap(command: string, model: string, openClawVersion: string): string;
}
export {};
//# sourceMappingURL=commit-attribution.d.ts.map