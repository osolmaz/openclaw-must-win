import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, join } from "node:path";
import type { AttributionPaths } from "./paths.js";
import { hashCommand, type ProcessSnapshot } from "./process-origin.js";

const SCHEMA_VERSION = 1;
const ACTIVE_TICKET_TTL_MS = 2 * 60 * 60 * 1_000;
const COMPLETED_TICKET_TTL_MS = 30 * 60 * 1_000;
const GATEWAY_TTL_MS = 5 * 60 * 1_000;
const MAX_TICKETS = 2_048;

export type AttributionMode = "best-effort" | "required";

export type GatewayRecord = {
  bootId: string;
  cgroup: string;
  expiresAt: number;
  gatewayId: string;
  mode: AttributionMode;
  openClawVersion: string;
  pid: number;
  schemaVersion: 1;
};

export type ExecutionTicket = {
  bootId: string;
  cgroup: string;
  commandHash: string;
  completedAt?: number;
  expiresAt: number;
  executionId?: string;
  gatewayId: string;
  mode: AttributionMode;
  model: string;
  openClawVersion: string;
  runId?: string;
  schemaVersion: 1;
  sessionKey?: string;
  startedAt: number;
  ticketId: string;
  toolCallId?: string;
  workdir?: string;
};

export type AttributionResolution =
  | { origin: "terminal" }
  | { mode: AttributionMode; origin: "openclaw"; reason: "ambiguous" | "missing" }
  | { origin: "openclaw"; ticket: ExecutionTicket };

export class AttributionContextStore {
  private readonly gatewaysDirectory: string;
  private readonly ticketsDirectory: string;

  constructor(
    private readonly paths: AttributionPaths,
    private readonly now: () => number = Date.now,
  ) {
    this.gatewaysDirectory = join(paths.runtimeDirectory, "gateways");
    this.ticketsDirectory = join(paths.runtimeDirectory, "tickets");
  }

  registerGateway(input: {
    identity: { bootId: string; cgroup: string };
    mode: AttributionMode;
    openClawVersion: string;
    pid?: number;
  }): GatewayRecord {
    const pid = input.pid ?? process.pid;
    const gatewayId = gatewayRecordId(input.identity.bootId, input.identity.cgroup, pid);
    const record: GatewayRecord = {
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

  refreshGateway(record: GatewayRecord): GatewayRecord {
    return this.registerGateway({
      identity: { bootId: record.bootId, cgroup: record.cgroup },
      mode: record.mode,
      openClawVersion: record.openClawVersion,
      pid: record.pid,
    });
  }

  unregisterGateway(gatewayId: string): void {
    rmSync(join(this.gatewaysDirectory, `${safeFilename(gatewayId)}.json`), { force: true });
  }

  recordTool(input: {
    command: string;
    executionId?: string;
    gateway: GatewayRecord;
    model: string;
    runId?: string;
    sessionKey?: string;
    toolCallId?: string;
    workdir?: string;
  }): ExecutionTicket {
    const startedAt = this.now();
    const ticketId = ticketRecordId(input.gateway.gatewayId, input.toolCallId);
    const ticket: ExecutionTicket = {
      bootId: input.gateway.bootId,
      cgroup: input.gateway.cgroup,
      commandHash: hashCommand(input.command),
      expiresAt: startedAt + ACTIVE_TICKET_TTL_MS,
      ...(input.executionId === undefined ? {} : { executionId: input.executionId }),
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

  completeTool(toolCallId: string | undefined, gatewayId: string): void {
    if (toolCallId === undefined) {
      return;
    }
    const ticketId = ticketRecordId(gatewayId, toolCallId);
    const path = join(this.ticketsDirectory, `${ticketId}.json`);
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

  resolve(snapshot: ProcessSnapshot): AttributionResolution {
    const now = this.now();
    const tickets = this.readTickets().filter(
      (ticket) =>
        ticket.bootId === snapshot.identity.bootId &&
        ticket.cgroup === snapshot.identity.cgroup &&
        ticket.expiresAt > now,
    );
    const gateways = this.readGateways().filter(
      (gateway) =>
        gateway.bootId === snapshot.identity.bootId &&
        gateway.cgroup === snapshot.identity.cgroup &&
        gateway.expiresAt > now,
    );
    if (tickets.length === 0 && gateways.length === 0) {
      return { origin: "terminal" };
    }

    const executionMatches = tickets.filter(
      (ticket) => ticket.executionId !== undefined && snapshot.executionIds.has(ticket.executionId),
    );
    const commandMatches = tickets.filter((ticket) =>
      snapshot.commandHashes.has(ticket.commandHash),
    );
    const matches = snapshot.executionIds.size > 0 ? executionMatches : commandMatches;
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

  prune(): void {
    const now = this.now();
    for (const path of this.listJsonFiles(this.gatewaysDirectory)) {
      const record = this.readGateway(path);
      if (record === undefined || record.expiresAt <= now) {
        rmSync(path, { force: true });
      }
    }

    const validTickets: { path: string; ticket: ExecutionTicket }[] = [];
    for (const path of this.listJsonFiles(this.ticketsDirectory)) {
      const ticket = this.readTicket(path);
      if (ticket === undefined || ticket.expiresAt <= now) {
        rmSync(path, { force: true });
      } else {
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

  private readGateways(): GatewayRecord[] {
    return this.listJsonFiles(this.gatewaysDirectory)
      .map((path) => this.readGateway(path))
      .filter((record): record is GatewayRecord => record !== undefined);
  }

  private readTickets(): ExecutionTicket[] {
    return this.listJsonFiles(this.ticketsDirectory)
      .map((path) => this.readTicket(path))
      .filter((ticket): ticket is ExecutionTicket => ticket !== undefined);
  }

  private readGateway(path: string): GatewayRecord | undefined {
    const value = this.readJson(path);
    return isGatewayRecord(value) ? value : undefined;
  }

  private readTicket(path: string): ExecutionTicket | undefined {
    const value = this.readJson(path);
    return isExecutionTicket(value) ? value : undefined;
  }

  private readJson(path: string): unknown {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as unknown;
    } catch {
      return undefined;
    }
  }

  private listJsonFiles(directory: string): string[] {
    try {
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => join(directory, entry.name));
    } catch {
      return [];
    }
  }

  private writeRecord(path: string, value: unknown): void {
    const directory = join(path, "..");
    mkdirSync(directory, { mode: 0o700, recursive: true });
    chmodSync(directory, 0o700);
    const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    chmodSync(path, 0o600);
  }
}

function selectUnique(tickets: ExecutionTicket[]): ExecutionTicket | undefined {
  return tickets.length === 1 ? tickets[0] : undefined;
}

function resolveMode(tickets: ExecutionTicket[], gateways: GatewayRecord[]): AttributionMode {
  return [...tickets, ...gateways].some((record) => record.mode === "required")
    ? "required"
    : "best-effort";
}

function gatewayRecordId(bootId: string, cgroup: string, pid: number): string {
  return createHash("sha256")
    .update(`${bootId}\0${cgroup}\0${String(pid)}`)
    .digest("hex")
    .slice(0, 32);
}

function ticketRecordId(gatewayId: string, toolCallId: string | undefined): string {
  return createHash("sha256")
    .update(`${gatewayId}\0${toolCallId ?? randomUUID()}`)
    .digest("hex")
    .slice(0, 32);
}

function safeFilename(value: string): string {
  return /^[a-f0-9]{32}$/u.test(value) ? value : "invalid";
}

function isGatewayRecord(value: unknown): value is GatewayRecord {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value["schemaVersion"] === SCHEMA_VERSION &&
    hasRequiredFields(
      value,
      ["bootId", "cgroup", "gatewayId", "openClawVersion"],
      ["expiresAt", "pid"],
    ) &&
    isMode(value["mode"])
  );
}

function isExecutionTicket(value: unknown): value is ExecutionTicket {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value["schemaVersion"] === SCHEMA_VERSION &&
    hasRequiredFields(
      value,
      ["bootId", "cgroup", "commandHash", "gatewayId", "model", "openClawVersion", "ticketId"],
      ["startedAt", "expiresAt"],
    ) &&
    hasOptionalFields(
      value,
      ["executionId", "runId", "sessionKey", "toolCallId", "workdir"],
      ["completedAt"],
    ) &&
    isMode(value["mode"])
  );
}

function hasRequiredFields(
  record: Record<string, unknown>,
  stringFields: string[],
  numberFields: string[],
): boolean {
  return (
    stringFields.every((field) => isString(record[field])) &&
    numberFields.every((field) => isFiniteNumber(record[field]))
  );
}

function hasOptionalFields(
  record: Record<string, unknown>,
  stringFields: string[],
  numberFields: string[],
): boolean {
  return (
    stringFields.every((field) => isOptionalString(record[field])) &&
    numberFields.every((field) => isOptionalFiniteNumber(record[field]))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isOptionalFiniteNumber(value: unknown): value is number | undefined {
  return value === undefined || isFiniteNumber(value);
}

function isMode(value: unknown): value is AttributionMode {
  return value === "best-effort" || value === "required";
}
