import { createHash, randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, } from "node:fs";
import { basename, join } from "node:path";
import { hashCommand } from "./process-origin.js";
const SCHEMA_VERSION = 1;
const ACTIVE_TICKET_TTL_MS = 2 * 60 * 60 * 1_000;
const COMPLETED_TICKET_TTL_MS = 30 * 60 * 1_000;
const GATEWAY_TTL_MS = 5 * 60 * 1_000;
const MAX_TICKETS = 2_048;
export class AttributionContextStore {
    paths;
    now;
    gatewaysDirectory;
    ticketsDirectory;
    constructor(paths, now = Date.now) {
        this.paths = paths;
        this.now = now;
        this.gatewaysDirectory = join(paths.runtimeDirectory, "gateways");
        this.ticketsDirectory = join(paths.runtimeDirectory, "tickets");
    }
    registerGateway(input) {
        const pid = input.pid ?? process.pid;
        const gatewayId = gatewayRecordId(input.identity.bootId, input.identity.cgroup, pid);
        const record = {
            bootId: input.identity.bootId,
            cgroup: input.identity.cgroup,
            expiresAt: this.now() + GATEWAY_TTL_MS,
            gatewayId,
            mode: input.mode,
            openClawVersion: input.openClawVersion,
            pid,
            schemaVersion: SCHEMA_VERSION,
        };
        this.writeRecord(join(this.gatewaysDirectory, `${gatewayId}.json`), record);
        this.prune();
        return record;
    }
    refreshGateway(record) {
        return this.registerGateway({
            identity: { bootId: record.bootId, cgroup: record.cgroup },
            mode: record.mode,
            openClawVersion: record.openClawVersion,
            pid: record.pid,
        });
    }
    unregisterGateway(gatewayId) {
        rmSync(join(this.gatewaysDirectory, `${safeFilename(gatewayId)}.json`), { force: true });
    }
    recordTool(input) {
        const startedAt = this.now();
        const ticketId = ticketRecordId(input.gateway.gatewayId, input.toolCallId);
        const ticket = {
            bootId: input.gateway.bootId,
            cgroup: input.gateway.cgroup,
            commandHash: hashCommand(input.command),
            expiresAt: startedAt + ACTIVE_TICKET_TTL_MS,
            gatewayId: input.gateway.gatewayId,
            mode: input.gateway.mode,
            model: input.model,
            openClawVersion: input.gateway.openClawVersion,
            ...(input.runId === undefined ? {} : { runId: input.runId }),
            schemaVersion: SCHEMA_VERSION,
            ...(input.sessionKey === undefined ? {} : { sessionKey: input.sessionKey }),
            startedAt,
            ticketId,
            ...(input.toolCallId === undefined ? {} : { toolCallId: input.toolCallId }),
            ...(input.workdir === undefined ? {} : { workdir: input.workdir }),
        };
        this.writeRecord(join(this.ticketsDirectory, `${ticketId}.json`), ticket);
        this.prune();
        return ticket;
    }
    completeTool(toolCallId, gatewayId) {
        if (toolCallId === undefined) {
            return;
        }
        this.completeTicketPath(join(this.ticketsDirectory, `${ticketRecordId(gatewayId, toolCallId)}.json`));
    }
    completeTicketPath(path) {
        const ticket = this.readTicket(path);
        if (ticket === undefined) {
            return;
        }
        const completedAt = this.now();
        this.writeRecord(path, {
            ...ticket,
            completedAt,
            expiresAt: completedAt + COMPLETED_TICKET_TTL_MS,
        });
    }
    resolve(snapshot) {
        const now = this.now();
        const tickets = this.readTickets().filter((ticket) => ticket.bootId === snapshot.identity.bootId &&
            ticket.cgroup === snapshot.identity.cgroup &&
            ticket.expiresAt > now);
        const gateways = this.readGateways().filter((gateway) => gateway.bootId === snapshot.identity.bootId &&
            gateway.cgroup === snapshot.identity.cgroup &&
            gateway.expiresAt > now);
        if (tickets.length === 0 && gateways.length === 0) {
            return { origin: "terminal" };
        }
        const matches = tickets.filter((ticket) => snapshot.commandHashes.has(ticket.commandHash));
        const activeMatches = matches.filter((ticket) => ticket.completedAt === undefined);
        const selected = selectUnique(activeMatches) ?? selectUnique(matches);
        if (selected !== undefined) {
            return { origin: "openclaw", ticket: selected };
        }
        const mode = resolveMode(tickets, gateways);
        return {
            mode,
            origin: "openclaw",
            reason: matches.length > 1 ? "ambiguous" : "missing",
        };
    }
    prune() {
        const now = this.now();
        for (const path of this.listJsonFiles(this.gatewaysDirectory)) {
            const record = this.readGateway(path);
            if (record === undefined || record.expiresAt <= now) {
                rmSync(path, { force: true });
            }
        }
        const validTickets = [];
        for (const path of this.listJsonFiles(this.ticketsDirectory)) {
            const ticket = this.readTicket(path);
            if (ticket === undefined || ticket.expiresAt <= now) {
                rmSync(path, { force: true });
            }
            else {
                validTickets.push({ path, ticket });
            }
        }
        validTickets
            .sort((left, right) => right.ticket.startedAt - left.ticket.startedAt)
            .slice(MAX_TICKETS)
            .forEach(({ path }) => {
            rmSync(path, { force: true });
        });
    }
    readGateways() {
        return this.listJsonFiles(this.gatewaysDirectory)
            .map((path) => this.readGateway(path))
            .filter((record) => record !== undefined);
    }
    readTickets() {
        return this.listJsonFiles(this.ticketsDirectory)
            .map((path) => this.readTicket(path))
            .filter((ticket) => ticket !== undefined);
    }
    readGateway(path) {
        const value = this.readJson(path);
        return isGatewayRecord(value) ? value : undefined;
    }
    readTicket(path) {
        const value = this.readJson(path);
        return isExecutionTicket(value) ? value : undefined;
    }
    readJson(path) {
        try {
            return JSON.parse(readFileSync(path, "utf8"));
        }
        catch {
            return undefined;
        }
    }
    listJsonFiles(directory) {
        try {
            return readdirSync(directory, { withFileTypes: true })
                .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
                .map((entry) => join(directory, entry.name));
        }
        catch {
            return [];
        }
    }
    writeRecord(path, value) {
        const directory = join(path, "..");
        mkdirSync(directory, { mode: 0o700, recursive: true });
        chmodSync(directory, 0o700);
        const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
        writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
        renameSync(temporary, path);
        chmodSync(path, 0o600);
    }
}
function selectUnique(tickets) {
    return tickets.length === 1 ? tickets[0] : undefined;
}
function resolveMode(tickets, gateways) {
    return [...tickets, ...gateways].some((record) => record.mode === "required")
        ? "required"
        : "best-effort";
}
function gatewayRecordId(bootId, cgroup, pid) {
    return createHash("sha256")
        .update(`${bootId}\0${cgroup}\0${String(pid)}`)
        .digest("hex")
        .slice(0, 32);
}
function ticketRecordId(gatewayId, toolCallId) {
    return createHash("sha256")
        .update(`${gatewayId}\0${toolCallId ?? randomUUID()}`)
        .digest("hex")
        .slice(0, 32);
}
function safeFilename(value) {
    return /^[a-f0-9]{32}$/u.test(value) ? value : "invalid";
}
function isGatewayRecord(value) {
    if (!isRecord(value)) {
        return false;
    }
    return (value["schemaVersion"] === SCHEMA_VERSION &&
        hasRequiredFields(value, ["bootId", "cgroup", "gatewayId", "openClawVersion"], ["expiresAt", "pid"]) &&
        isMode(value["mode"]));
}
function isExecutionTicket(value) {
    if (!isRecord(value)) {
        return false;
    }
    return (value["schemaVersion"] === SCHEMA_VERSION &&
        hasRequiredFields(value, ["bootId", "cgroup", "commandHash", "gatewayId", "model", "openClawVersion", "ticketId"], ["startedAt", "expiresAt"]) &&
        hasOptionalFields(value, ["runId", "sessionKey", "toolCallId", "workdir"], ["completedAt"]) &&
        isMode(value["mode"]));
}
function hasRequiredFields(record, stringFields, numberFields) {
    return (stringFields.every((field) => isString(record[field])) &&
        numberFields.every((field) => isFiniteNumber(record[field])));
}
function hasOptionalFields(record, stringFields, numberFields) {
    return (stringFields.every((field) => isOptionalString(record[field])) &&
        numberFields.every((field) => isOptionalFiniteNumber(record[field])));
}
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isString(value) {
    return typeof value === "string" && value.length > 0;
}
function isOptionalString(value) {
    return value === undefined || isString(value);
}
function isFiniteNumber(value) {
    return typeof value === "number" && Number.isFinite(value);
}
function isOptionalFiniteNumber(value) {
    return value === undefined || isFiniteNumber(value);
}
function isMode(value) {
    return value === "best-effort" || value === "required";
}
//# sourceMappingURL=context-store.js.map