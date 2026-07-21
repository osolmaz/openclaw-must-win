import { readFileSync } from "node:fs";
export type ProcessIdentity = {
    bootId: string;
    cgroup: string;
};
export type ProcessSnapshot = {
    commandHashes: ReadonlySet<string>;
    identity: ProcessIdentity;
};
export declare function hashCommand(command: string): string;
export declare function readProcessIdentity(pid?: number, readFile?: typeof readFileSync): ProcessIdentity | undefined;
export declare function readProcessSnapshot(pid?: number, readFile?: typeof readFileSync): ProcessSnapshot | undefined;
//# sourceMappingURL=process-origin.d.ts.map