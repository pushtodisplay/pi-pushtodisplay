/**
 * Configuration for the pi-pushtodisplay extension.
 *
 * All settings come from environment variables so each pi agent can write to a
 * different panel without any per-session config files:
 *
 *   PUSHTODISPLAY_BOARD_ID   Send to a specific board (default: your default board)
 *   PUSHTODISPLAY_PANEL      (1-4) which panel this agent writes to (default 1)
 *   PUSHTODISPLAY_LABEL      agent name shown on its panel (default: session name, then folder)
 *   PUSHTODISPLAY_DISABLED   Set to "1" to disable the extension entirely
 *   PUSHTODISPLAY_STEPS      Set to "0" to post milestones only, not each tool call
 */

export const MAX_PANEL = 4;
export const MIN_PANEL = 1;

export interface Config {
  /** Board ID to send to; empty string means "use the default board". */
  boardId: string;
  /** Which panel (1-4) this agent writes to. */
  panel: number;
  /** Friendly agent name shown on the panel (e.g. "Alice", "cicd"). */
  label: string;
  /** When true, the extension does nothing. */
  disabled: boolean;
  /** When true, every tool call is posted as its own log entry. */
  steps: boolean;
}

/** Parse an integer between MIN_PANEL and MAX_PANEL, falling back to `dflt`. */
export function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= MIN_PANEL && n <= MAX_PANEL ? n : dflt;
}

/** Normalize whitespace and enforce a max length, appending an ellipsis. */
export function truncate(s: string, n: number): string {
  const clean = (s ?? "").replace(/\s+/g, " ").trim();
  if (clean.length <= n) return clean;
  const cut = clean.slice(0, n - 1);
  const space = cut.lastIndexOf(" ");
  // Prefer a word boundary; fall back to a hard cut for single long tokens
  // (a path, a hash) where cutting mid-token is the least bad option.
  const body = space > n * 0.6 ? cut.slice(0, space) : cut;
  return body.trimEnd() + "…";
}

/** Current wall-clock time as HH:MM:SS. */
export function clock(): string {
  const d = new Date();
  return [d.getHours(), d.getMinutes(), d.getSeconds()]
    .map((x) => String(x).padStart(2, "0"))
    .join(":");
}

/** Read the extension config from the environment. Pure — testable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    boardId: env.PUSHTODISPLAY_BOARD_ID ?? "",
    panel: num(env.PUSHTODISPLAY_PANEL, 1),
    label: env.PUSHTODISPLAY_LABEL ?? "",
    disabled: env.PUSHTODISPLAY_DISABLED === "1",
    steps: env.PUSHTODISPLAY_STEPS !== "0",
  };
}