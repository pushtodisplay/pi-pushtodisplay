/**
 * Adapter for the `pushtodisplay` CLI (`npm i pushtodisplay`).
 *
 * The CLI implements the OAuth 2.0 device-code flow against
 * https://idp.pushtodisplay.com. It stores credentials in the OS keychain
 * (macOS Keychain, Linux libsecret, Windows Credential Manager) and falls back
 * to ~/.config/pushtodisplay/credentials.json only when no keychain is
 * available, auto-refreshing the access token.
 *
 * Binary resolution, in order:
 *   1. the `pushtodisplay` npm dependency installed next to this package
 *      (self-contained installs via `pi install`),
 *   2. a global `pushtodisplay` binary on PATH (manual setups).
 */
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import * as path from "node:path";

import type { Payload } from "./payloads.ts";

const execFileAsync = promisify(execFile);

export interface CliCommand {
  /** Executable to spawn (either the bare CLI name or `process.execPath`). */
  exe: string;
  /** Extra argv to pass before the CLI's own args. */
  prefix: string[];
  /** Where the command came from — used for diagnostics. */
  source: "npm-dep" | "path";
}

/** Resolve a bare package id to an absolute path (e.g. via `require.resolve`). */
export type ModuleResolver = (id: string) => string | undefined;

let resolver: ModuleResolver | null = null;
let cachedCommand: CliCommand | null = null;

/**
 * Point the adapter at the installed `pushtodisplay` npm dependency.
 *
 * Called once from the extension entry (`index.ts`) with a `createRequire`
 * bound to the extension file, so `require.resolve` finds the package's own
 * node_modules. Optional — when unset (or failing) the adapter falls back to
 * a `pushtodisplay` binary on PATH.
 */
export function configureCliResolver(fn: ModuleResolver | null): void {
  resolver = fn;
  cachedCommand = null;
}

function packageBinPath(): string | null {
  if (!resolver) return null;
  try {
    const pkgJsonPath = resolver("pushtodisplay/package.json");
    if (!pkgJsonPath) return null;
    const pkgRoot = path.dirname(pkgJsonPath);
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8")) as {
      bin?: string | Record<string, string>;
    };
    const bin = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.pushtodisplay;
    if (!bin) return null;
    const p = path.resolve(pkgRoot, bin);
    return existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

/** Resolve how to invoke the CLI. Result is cached for the process lifetime. */
export function resolveCli(): CliCommand {
  if (cachedCommand) return cachedCommand;
  const bin = packageBinPath();
  if (bin) {
    cachedCommand = { exe: process.execPath, prefix: [bin], source: "npm-dep" };
  } else {
    cachedCommand = { exe: "pushtodisplay", prefix: [], source: "path" };
  }
  return cachedCommand;
}

/** Allow tests to reset the cached resolution. */
export function __resetCliCache(): void {
  cachedCommand = null;
}

async function runCli(args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  const { exe, prefix } = resolveCli();
  // execFile compares exit codes; a missing PATH binary raises ENOENT which
  // callers surface as a helpful "CLI not installed" diagnostic.
  const { stdout, stderr } = await execFileAsync(exe, [...prefix, ...args], {
    timeout: timeoutMs,
    encoding: "utf8",
  });
  return { stdout: String(stdout), stderr: String(stderr) };
}

/** Build the CLI argv for a board update payload. */
export function sendArgs(payload: Payload, boardId: string): string[] {
  const args = ["send"];
  if (boardId) args.push("-b", boardId);
  args.push("-p", String(payload.panelId));
  if (payload.background) args.push("--background", payload.background);
  if (payload.density) args.push("--density", payload.density);
  for (const b of payload.blocks) args.push("--block", JSON.stringify(b));
  return args;
}

/** Send a display update. Throws on failure (auth or network). */
export async function sendPayload(payload: Payload, boardId: string): Promise<void> {
  await runCli(sendArgs(payload, boardId), 15_000);
}

/**
 * Probe auth state.
 *
 * Uses `auth status --json` (exit 0 = authenticated, non-zero = not). The CLI
 * reports effective auth — an expired access token with a valid refresh token
 * still counts as authenticated since it refreshes transparently. Falls back to
 * legacy text heuristics when the installed CLI predates JSON status output.
 */
export async function authStatus(): Promise<boolean> {
  try {
    const { stdout } = await runCli(["auth", "status", "--json"], 10_000);
    try {
      const parsed = JSON.parse(stdout) as { authenticated?: boolean };
      if (typeof parsed.authenticated === "boolean") {
        return parsed.authenticated;
      }
    } catch {
      // Not JSON — likely an older CLI that ignores --json; fall through.
    }
    // Legacy heuristic (old CLI exits 0 whether logged in or not).
    const denied = /Not authenticated/i.test(stdout) || /\(expired\)/i.test(stdout);
    const confirmed = /Auth method/i.test(stdout) && /All commands available/i.test(stdout);
    return confirmed && !denied;
  } catch {
    // Non-zero exit → not authenticated (new CLI contract).
    return false;
  }
}

/** Spawn the CLI for the OAuth device-code flow, streaming stdout/stderr. */
export function spawnCli(args: string[], stdio: "pipe" | "ignore" = "pipe"): ChildProcess {
  const { exe, prefix } = resolveCli();
  return spawn(exe, [...prefix, ...args], {
    stdio: [stdio === "pipe" ? "ignore" : "ignore", stdio === "pipe" ? "pipe" : "ignore", "pipe"],
  });
}

/** True when the failure looks like an auth problem (401/403/unauthorized). */
export function isAuthFailure(err: unknown): boolean {
  return /unauthor|401|403|forbidden/i.test((err as Error)?.message ?? "");
}

/** True when the underlying executable could not be spawned at all (ENOENT). */
export function isCliMissing(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === "ENOENT";
}

/** Human-readable install hint shown when the CLI cannot be found at all. */
export function cliNotFoundMessage(): string {
  return [
    "Push To Display CLI not found.",
    "Install it with: npm i -g pushtodisplay",
    "(When installed via `pi install`, the CLI is included automatically.)",
  ].join(" ");
}