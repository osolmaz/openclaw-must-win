export type ModelCall = {
    model: string;
    provider?: string;
    runId: string;
    sessionKey?: string;
};
export type AttributionContext = {
    runId?: string | undefined;
    sessionKey?: string | undefined;
};
export declare class ModelAttribution {
    private readonly modelsByRun;
    private readonly modelsBySession;
    private readonly sessionsByRun;
    record(call: ModelCall): void;
    resolve(context: AttributionContext): string | undefined;
    endSession(sessionKey: string | undefined): void;
    clear(): void;
    private evictSession;
}
export declare function formatModel(provider: string | undefined, model: string): string;
//# sourceMappingURL=model-attribution.d.ts.map