type SessionModel = {
    modelOverride?: string;
    providerOverride?: string;
};
type SessionReader = (sessionKey: string, agentId: string | undefined) => SessionModel | undefined;
export declare function resolveConfiguredModel(input: {
    agentId?: string;
    config: unknown;
    sessionKey?: string;
}, readEntry?: SessionReader): string | undefined;
export {};
//# sourceMappingURL=configured-model.d.ts.map