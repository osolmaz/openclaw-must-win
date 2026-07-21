#!/usr/bin/env node
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { doctorDispatcher, installDispatcher, uninstallDispatcher } from "./installer.js";
import { isGitHookName } from "./git-hooks.js";
import { runGitHook } from "./git-hook-runner.js";
import { resolveAttributionPaths } from "./paths.js";

export function runCli(argv: string[]): number {
  try {
    return dispatchCommand(argv);
  } catch (error) {
    process.stderr.write(`openclaw-must-win: ${formatError(error)}\n`);
    return 1;
  }
}

function dispatchCommand([command, ...args]: string[]): number {
  switch (command) {
    case undefined:
      printUsage();
      return 0;
    case "setup":
      return runSetup();
    case "doctor":
      return runDoctor();
    case "uninstall":
      return runUninstall();
    case "hook":
      return runHook(args);
    default:
      printUsage();
      return command === "help" || command === "--help" ? 0 : 2;
  }
}

function runSetup(): number {
  const state = installDispatcher({
    paths: resolveAttributionPaths(),
    sourceRuntimeDirectory: dirname(fileURLToPath(import.meta.url)),
  });
  process.stdout.write(`Installed Git dispatcher at ${state.hooksDirectory}\n`);
  return 0;
}

function runDoctor(): number {
  const result = doctorDispatcher({ paths: resolveAttributionPaths() });
  for (const warning of result.warnings) {
    process.stdout.write(`warning: ${warning}\n`);
  }
  for (const error of result.errors) {
    process.stderr.write(`error: ${error}\n`);
  }
  if (result.ok) {
    process.stdout.write("OpenClaw Must Win is ready\n");
  }
  return result.ok ? 0 : 1;
}

function runUninstall(): number {
  uninstallDispatcher({ paths: resolveAttributionPaths() });
  process.stdout.write("Removed the Git dispatcher and restored the previous core.hooksPath\n");
  return 0;
}

function runHook([hookName, ...hookArgs]: string[]): number {
  if (hookName === undefined || !isGitHookName(hookName)) {
    process.stderr.write("openclaw-must-win: invalid Git hook name\n");
    return 2;
  }
  const result = runGitHook(hookName, hookArgs, resolveAttributionPaths());
  if (result.message) {
    process.stderr.write(`${result.message}\n`);
  }
  return result.status;
}

function printUsage(): void {
  process.stdout.write(
    `Usage: openclaw-must-win <command>\n\nCommands:\n  setup      Install the user-level Git dispatcher\n  doctor     Check Git dispatcher and platform state\n  uninstall  Restore the previous Git hook configuration\n`,
  );
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = runCli(process.argv.slice(2));
}
