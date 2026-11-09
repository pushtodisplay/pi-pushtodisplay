/**
 * The explicit setup flow for this pi integration.
 *
 * A shared Push To Display login is intentionally not enough to enable this
 * extension. Setup proves three things in order:
 *
 *   1. auth is valid (logging in first when needed),
 *   2. the configured board/panel accepts a real test entry,
 *   3. only then, write the per-pi setup marker.
 *
 * Re-running setup refreshes the marker. Re-authenticating through
 * `/pushtodisplay-login` never removes an existing marker.
 */
import {
  PUSHTODISPLAY_CLI_VERSION,
  authStatus,
  cliNotFoundMessage,
  isAuthFailure,
  isCliMissing,
  sendPayload,
} from "./cli-adapter.ts";
import { clock, type Config } from "./config.ts";
import { testMessage } from "./messages.ts";
import type { Payload } from "./payloads.ts";
import { markSetupComplete, type SetupRecord } from "./setup-state.ts";

export type SetupFailureReason =
  | "login-failed"
  | "auth-missing"
  | "auth-failed"
  | "cli-missing"
  | "send-failed";

export type SetupResult =
  | { ok: true; record: SetupRecord }
  | { ok: false; reason: SetupFailureReason; message: string };

export interface SetupOptions {
  /** Run the interactive device-code login; resolves true on success. */
  login: () => Promise<boolean>;
  config: Config;
  label: string;
  env?: NodeJS.ProcessEnv;
  onProgress?: (message: string) => void;
  /** Overrides for tests. */
  authProbe?: () => Promise<boolean>;
  send?: (payload: Payload, boardId: string) => Promise<void>;
}

/**
 * Log in if needed, send one test entry, then write the setup marker.
 *
 * The marker is written only after the test send succeeds. A failed login or a
 * failed test leaves automatic updates disabled.
 */
export async function setupIntegration(options: SetupOptions): Promise<SetupResult> {
  const env = options.env ?? process.env;
  const probe = options.authProbe ?? authStatus;
  const send = options.send ?? ((payload, boardId) => sendPayload(payload, boardId));

  let authed = await probe();
  if (!authed) {
    options.onProgress?.("Push To Display is not logged in. Starting device-code login…");
    const loggedIn = await options.login();
    if (!loggedIn) {
      return {
        ok: false,
        reason: "login-failed",
        message: "Login failed or was cancelled.",
      };
    }
    authed = await probe();
    if (!authed) {
      return {
        ok: false,
        reason: "auth-missing",
        message: "Login finished but auth is still unavailable.",
      };
    }
  } else {
    options.onProgress?.("Push To Display is already authenticated.");
  }

  const payload = testMessage({
    panelId: options.config.panel,
    agent: options.label,
    wall: clock(),
  });
  try {
    await send(payload, options.config.boardId);
  } catch (error) {
    if (isAuthFailure(error)) {
      return {
        ok: false,
        reason: "auth-failed",
        message: "Not authenticated. Run /pushtodisplay-login to log in again.",
      };
    }
    if (isCliMissing(error)) {
      return { ok: false, reason: "cli-missing", message: cliNotFoundMessage() };
    }
    return {
      ok: false,
      reason: "send-failed",
      message: `Test entry failed: ${(error as Error).message}`,
    };
  }

  options.onProgress?.("Test entry sent.");
  const record = markSetupComplete(
    {
      boardId: options.config.boardId,
      panel: options.config.panel,
      label: options.label,
      cliVersion: PUSHTODISPLAY_CLI_VERSION,
    },
    env,
  );
  return { ok: true, record };
}
