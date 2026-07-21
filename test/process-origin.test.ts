import { describe, expect, it } from "vitest";
import { hashCommand, readProcessIdentity, readProcessSnapshot } from "../src/process-origin.js";

function stat(pid: number, parent: number): string {
  const fields = [
    "S",
    String(parent),
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    String(pid * 10),
  ];
  return `${String(pid)} (process ${String(pid)}) ${fields.join(" ")}`;
}

function fakeReader(files: Record<string, string | Buffer>) {
  return ((path: unknown, options?: unknown) => {
    const value = files[String(path)];
    if (value === undefined) {
      throw new Error("missing");
    }
    if (options === "utf8") {
      return Buffer.isBuffer(value) ? value.toString("utf8") : value;
    }
    return Buffer.isBuffer(value) ? value : Buffer.from(value);
  }) as typeof import("node:fs").readFileSync;
}

describe("process origin", () => {
  it("reads normalized process identity", () => {
    const readFile = fakeReader({
      "/proc/7/cgroup": "1:name=/other\n0::/openclaw.service\n",
      "/proc/sys/kernel/random/boot_id": "boot-id\n",
    });

    expect(readProcessIdentity(7, readFile)).toEqual({
      bootId: "boot-id",
      cgroup: "0::/openclaw.service\n1:name=/other",
    });
  });

  it("collects full invocations, shell payloads, and execution ids", () => {
    const executionId = "123e4567-e89b-42d3-a456-426614174000";
    const readFile = fakeReader({
      "/proc/7/cgroup": "0::/openclaw.service\n",
      "/proc/7/cmdline": Buffer.from("node\0hook.js\0"),
      "/proc/7/environ": Buffer.from(`PATH=/bin\0OPENCLAW_MUST_WIN_EXECUTION_ID=${executionId}\0`),
      "/proc/7/stat": stat(7, 6),
      "/proc/6/cmdline": Buffer.from("git\0commit\0-m\0two words\0"),
      "/proc/6/stat": stat(6, 5),
      "/proc/5/cmdline": Buffer.from('bash\0-lc\0git commit -m "two words"\0'),
      "/proc/5/stat": stat(5, 1),
      "/proc/sys/kernel/random/boot_id": "boot-id\n",
    });

    const snapshot = readProcessSnapshot(7, readFile);
    expect(snapshot?.commandHashes.has(hashCommand('git commit -m "two words"'))).toBe(true);
    expect(snapshot?.commandHashes.has(hashCommand("git commit -m two words"))).toBe(true);
    expect(snapshot?.commandHashes.has(hashCommand("git"))).toBe(false);
    expect(snapshot?.executionIds.has(executionId)).toBe(true);
    expect(snapshot?.identity.cgroup).toBe("0::/openclaw.service");
  });

  it("stops safely at unreadable and malformed ancestors", () => {
    const readFile = fakeReader({
      "/proc/7/cgroup": "0::/openclaw.service\n",
      "/proc/7/cmdline": Buffer.from("node\0"),
      "/proc/7/stat": "malformed",
      "/proc/sys/kernel/random/boot_id": "boot\n",
    });
    expect(readProcessSnapshot(7, readFile)?.commandHashes.has(hashCommand("node"))).toBe(true);
    const unreadableCommand = fakeReader({
      "/proc/7/cgroup": "0::/openclaw.service\n",
      "/proc/sys/kernel/random/boot_id": "boot\n",
    });
    expect(readProcessSnapshot(7, unreadableCommand)?.commandHashes.size).toBe(0);
  });

  it("fails closed when proc identity is unavailable", () => {
    const readFile = fakeReader({});
    expect(readProcessIdentity(7, readFile)).toBeUndefined();
    expect(readProcessSnapshot(7, readFile)).toBeUndefined();
    expect(
      readProcessIdentity(
        7,
        fakeReader({
          "/proc/7/cgroup": "\n",
          "/proc/sys/kernel/random/boot_id": "boot\n",
        }),
      ),
    ).toBeUndefined();
  });
});
