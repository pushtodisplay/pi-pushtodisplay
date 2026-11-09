/**
 * Per-pi-install setup state.
 *
 * A valid `pushtodisplay` credential is shared by every integration on the
 * machine (Codex, opencode, pi, Claude, ...). Credential presence therefore
 * must not be treated as "this pi extension is set up". This marker is written
 * only after the pi setup flow has verified auth and sent a test entry.
 *
 * The marker lives under this package's own cache namespace:
 *
 *   ~/.cache/pushtodisplay/pi/setup.json
 *
 * so a marker written by another integration (for example
 * `~/.cache/pushtodisplay/codex/setup.json`) never enables this one.
 *
 * `PUSHTODISPLAY_PI_CACHE_DIR` is an internal/test override; it is not part of
 * the documented user configuration.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const SETUP_VERSION = 1;

/** Root of this integration's per-user state. */
export function cacheDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.PUSHTODISPLAY_PI_CACHE_DIR) return env.PUSHTODISPLAY_PI_CACHE_DIR;
  const base = env.XDG_CACHE_HOME?.replace(/[\\/]+$/, "");
  if (base) return path.join(base, "pushtodisplay", "pi");
  const home = env.HOME || os.homedir();
  return path.join(home, ".cache", "pushtodisplay", "pi");
}

/** Absolute path to this integration's setup marker. */
export function setupPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(cacheDir(env), "setup.json");
}

/** True only for a marker written by this package's setup flow. */
export function isSetupComplete(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const parsed = JSON.parse(fs.readFileSync(setupPath(env), "utf8")) as {
      version?: unknown;
      completedAt?: unknown;
    };
    return (
      parsed !== null &&
      typeof parsed === "object" &&
      parsed.version === SETUP_VERSION &&
      Number(parsed.completedAt) > 0
    );
  } catch {
    return false;
  }
}

export interface SetupDetails {
  boardId?: string;
  panel?: number;
  label?: string;
  cliVersion?: string;
}

export interface SetupRecord {
  version: number;
  completedAt: number;
  integration: "pi";
  boardId: string;
  panel: number;
  label: string;
  cliVersion: string;
}

/**
 * Record a completed setup for this pi extension. Atomic write; deliberately
 * per-user/per-integration, never per-session. Only the explicit setup flow
 * calls this.
 */
export function markSetupComplete(
  details: SetupDetails = {},
  env: NodeJS.ProcessEnv = process.env,
): SetupRecord {
  const dir = cacheDir(env);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = setupPath(env);
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  const record: SetupRecord = {
    version: SETUP_VERSION,
    completedAt: Date.now(),
    integration: "pi",
    boardId: details.boardId ?? "",
    panel: details.panel ?? 1,
    label: details.label ?? "",
    cliVersion: details.cliVersion ?? "",
  };
  fs.writeFileSync(temp, JSON.stringify(record), { mode: 0o600 });
  fs.renameSync(temp, target);
  return record;
}
