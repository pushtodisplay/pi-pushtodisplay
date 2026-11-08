/**
 * Push To Display extension for pi.
 *
 * Mirrors agent activity onto a Push To Display board. One panel is a *shared*
 * scrolling log: every entry is its own message, newest at the top, and any
 * agent may write to any panel.
 *
 *   pi-pushtodisplay session closed ENDED 11:09
 *   pi-pushtodisplay Pinned the clock so the test passes. DONE 11:08
 *   pi-pushtodisplay Allow bash: git push NEEDS 11:07
 *   qa running grep FAIL 11:06
 *   pi-pushtodisplay running npm test OK 11:05
 *   pi-pushtodisplay fix the flaky release test RUN 11:04
 *   pi-pushtodisplay session opened READY 11:04
 *
 * Every line has the same four runs — agent, event, status, time — because a
 * panel is shared and a line without a speaker is unreadable. Colour is the
 * only thing that varies; see `messages.ts` and `payloads.ts`.
 *
 * Rendering model (from the Push To Display app): a message is ONE wrapping
 * paragraph; `blocks` are inline runs like `<span>`, not lines like `<p>`. So
 * each builder in `messages.ts` produces a single sentence.
 *
 * Authentication is OAuth-only (no API keys). It reuses the `pushtodisplay`
 * CLI, which implements the OAuth 2.0 device-code flow against
 * https://idp.pushtodisplay.com. Credentials live in the OS keychain (macOS
 * Keychain, Linux libsecret, Windows Credential Manager), with a plaintext
 * fallback at ~/.config/pushtodisplay/credentials.json only when no keychain
 * is available; the access token refreshes automatically.
 *
 *   /pushtodisplay-login    start the OAuth login from inside pi (opens browser)
 *   /pushtodisplay-status   show current auth state
 *   /pushtodisplay-test     send a test entry to the board (verify wiring)
 *   /pushtodisplay-clear    write a `log cleared` entry to this panel
 *
 * Optional env vars:
 *   PUSHTODISPLAY_BOARD_ID      Send to a specific board (default: your default board)
 *   PUSHTODISPLAY_PANEL         (1-4) which panel this agent writes to (default 1)
 *   PUSHTODISPLAY_LABEL         agent name shown on every line (default: session name, then folder name)
 *   PUSHTODISPLAY_STEPS         Set to "0" to skip per-tool entries
 *   PUSHTODISPLAY_DISABLED      Set to "1" to disable entirely.
 *
 * Auth gating: an unknown auth state *waits* for the probe rather than dropping
 * the message; a known-bad state drops, and re-probes lazily on the next send
 * (at most once per `PROBE_INTERVAL_MS`).
 *
 * Every API call counts toward the monthly message quota and is capped around
 * 1 msg/s by the Sandbox tier, so `sender.ts` keeps one ordered queue, spaced
 * and bounded.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

import { loadConfig, clock } from "./config.ts";
import {
  createState,
  beginSession,
  beginTask,
  noteAssistant,
} from "./panel-state.ts";
import {
  sessionOpenedMessage,
  sessionClosedMessage,
  renamedMessage,
  taskMessage,
  stepMessage,
  doneMessage,
  blockedMessage,
  stoppedMessage,
  errorMessage,
  testMessage,
  clearedMessage,
} from "./messages.ts";
import { AuthGate } from "./auth-gate.ts";
import { Sender } from "./sender.ts";
import type { Payload } from "./payloads.ts";
import {
  sendPayload,
  authStatus,
  spawnCli,
  isAuthFailure,
  isCliMissing,
  cliNotFoundMessage,
} from "./cli-adapter.ts";

const execFileAsync = promisify(execFile);

// The bundled-CLI resolver is configured by the entry point (index.ts), which
// owns the `import.meta` needed to resolve this package's own node_modules.

/** Keep sends comfortably above the Sandbox tier's ~1 msg/s cap. */
const MIN_INTERVAL_MS = 1200;
/** Queued entries before the oldest steps are dropped (~30 s of lag). */
const MAX_PENDING = 25;
const PROBE_INTERVAL_MS = 20_000;

// ---- notification helper (works with or without a TUI) ---------------------
interface NotifyUI {
  hasUI: boolean;
  ui?: { notify(msg: string, type: "info" | "warning" | "error"): void };
}
let lastCtx: NotifyUI | null = null;
function notify(msg: string, type: "info" | "warning" | "error") {
  if (lastCtx?.hasUI && lastCtx.ui) lastCtx.ui.notify(msg, type);
  else console.log(`[pushtodisplay] ${msg}`);
}

export default function extension(pi: ExtensionAPI) {
  const conf = loadConfig();
  if (conf.disabled) return;

  // ---- agent identity ------------------------------------------------------
  // NOTE: only allow-listed calls (pi.on, pi.registerCommand, ...) may run while
  // the factory executes. Anything backed by the extension runtime — notably
  // pi.getSessionName() — throws "Extension runtime not initialized" during
  // loading, which takes the whole extension (and its commands) down with it,
  // so the name is only read once pi has started a session.
  //
  // Precedence: an explicit PUSHTODISPLAY_LABEL, then the session name you set
  // with `/name`, then the workspace folder. The folder is the last resort
  // because a bare folder name is what you recognise on a four-agent board when
  // nothing has been named.
  let sessionName = "";

  function agentLabel(): string {
    const label = conf.label && conf.label.trim();
    if (label) return label;
    if (sessionName) return sessionName;
    const dir = state.cwd || process.cwd();
    return path.basename(dir) || "agent";
  }

  // ---- panel state ---------------------------------------------------------
  const state = createState({
    agent: conf.label.trim() || path.basename(process.cwd()) || "agent",
    cwd: process.cwd(),
  });

  // A provider error is only a failure if the run was not aborted: pi reports
  // an abort as an assistant error too ("This operation was aborted"), and
  // posting that as FAIL would contradict the STOP line. Hold error lines until
  // agent_settled says whether the run was aborted.
  let pendingErrors: Payload[] = [];

  // ---- auth gating ---------------------------------------------------------
  // "Unknown" and "known-unauthenticated" are different states. Waiting for the
  // first probe is mandatory: the turn that greets you right after a reload has
  // no tool calls, so if the probe has not answered yet, dropping the task line
  // and the result line means the whole turn produces nothing at all.
  let authLostNotified = false;
  let cliMissingNotified = false;

  const gate = new AuthGate(() => authStatus(), PROBE_INTERVAL_MS);

  function handleSendError(err: unknown) {
    if (isCliMissing(err)) {
      if (cliMissingNotified) return;
      cliMissingNotified = true;
      notify(`⚠️ ${cliNotFoundMessage()}`, "error");
      return;
    }
    if (isAuthFailure(err)) {
      // The gate re-probes on the next send (at most once per interval), so no
      // timer is needed here: a recovered login is noticed when it matters.
      gate.revoke();
      notifyAuthNeeded();
      return;
    }
    // Transient/network error — don't flip auth state, just don't spam logs.
    console.error("[pushtodisplay] send failed:", (err as Error).message);
  }

  function notifyAuthNeeded() {
    if (authLostNotified) return;
    authLostNotified = true;
    notify("⚠️ Push To Display not authenticated — updates paused. Run /pushtodisplay-login", "warning");
  }

  async function settleAuth(): Promise<boolean> {
    const ok = await gate.start();
    if (ok) authLostNotified = false;
    else notifyAuthNeeded();
    return ok;
  }

  // ---- transport -----------------------------------------------------------
  // Auth is enforced at dispatch time so every entry is gated the same way.
  const sender = new Sender(
    async (payload) => {
      // Waits for an in-flight probe instead of discarding the message: the
      // first seconds of a session are exactly when a fast turn reports.
      if (!(await gate.allowed())) return;
      await sendPayload(payload, conf.boardId);
    },
    MIN_INTERVAL_MS,
    MAX_PENDING,
    (err) => handleSendError(err),
  );

  // ---- pi event wiring -----------------------------------------------------
  // Eight events speak: the session opening, a rename, a new task, each
  // finished tool step, a provider error, a blocking prompt, the end of a run,
  // and the session closing. Everything else is state.

  pi.on("session_start", (_event, ctx) => {
    lastCtx = ctx as unknown as NotifyUI;
    state.cwd = ctx.cwd || process.cwd();
    sessionName = (pi.getSessionName() ?? "").trim();
    state.agent = agentLabel();
    beginSession(state);
    // The panel explains its own silence: an opened session says so, otherwise
    // a fresh agent is indistinguishable from a panel nobody uses.
    sender.enqueue(
      sessionOpenedMessage({ panelId: conf.panel, agent: state.agent, wall: clock() }),
      { urgent: true },
    );
    void settleAuth();
  });

  pi.on("session_info_changed", (event) => {
    sessionName = (event.name ?? "").trim();
    state.agent = agentLabel();
    // Say it out loud: a rename would otherwise only surface on the next entry,
    // which looks like it did not take.
    if (!sessionName) return;
    sender.enqueue(
      renamedMessage({ panelId: conf.panel, agent: state.agent, wall: clock() }),
      { urgent: true },
    );
  });

  pi.on("before_agent_start", (event) => {
    // Custom-message runs carry no prompt; keep the existing task in that case.
    beginTask(state, event.messageType === "user" ? event.prompt : "");
    sender.enqueue(
      taskMessage({
        panelId: conf.panel,
        agent: state.agent,
        wall: clock(),
        task: state.task,
        cwd: state.cwd,
      }),
      { urgent: true },
    );
  });

  // `tool_execution_end` carries no args, but describing the step needs them,
  // so remember them for the duration of the call only.
  const callArgs = new Map<string, unknown>();

  pi.on("tool_execution_start", (event) => {
    callArgs.set(event.toolCallId, event.args);
    // Bound the map in case a call never reports an end.
    while (callArgs.size > 64) {
      const oldest = callArgs.keys().next().value;
      if (oldest === undefined) break;
      callArgs.delete(oldest);
    }
  });

  pi.on("tool_execution_end", (event) => {
    const args = callArgs.get(event.toolCallId);
    callArgs.delete(event.toolCallId);
    if (!conf.steps) return;
    // Posted when the step finishes, so the line states what actually happened
    // instead of leaving a stale "running" behind it.
    sender.enqueue(
      stepMessage({
        panelId: conf.panel,
        agent: state.agent,
        wall: clock(),
        toolName: event.toolName,
        args: args ?? {},
        cwd: state.cwd,
        ok: !event.isError,
      }),
    );
  });

  pi.on("message_end", (event) => {
    const message = event.message as { role?: string; stopReason?: string; errorMessage?: string };
    if (message?.role === "assistant" && message.stopReason !== "error") {
      // Remember the answer: the result line quotes it.
      noteAssistant(state, event.message);
      return;
    }
    if (message?.role !== "assistant" || message.stopReason !== "error") return;
    // Defer: the same event fires for a user abort, and only agent_settled can
    // tell the two apart. Build the payload now so the line keeps the time the
    // error actually happened.
    pendingErrors.push(
      errorMessage({
        panelId: conf.panel,
        agent: state.agent,
        wall: clock(),
        detail: message.errorMessage ?? "",
      }),
    );
  });

  pi.on("ui_prompt_start", (event) => {
    sender.enqueue(
      blockedMessage({
        panelId: conf.panel,
        agent: state.agent,
        wall: clock(),
        kind: event.kind,
        title: event.title,
      }),
      { urgent: true },
    );
  });

  pi.on("agent_settled", (event) => {
    if (event.aborted) {
      // You pressed Escape — nothing went wrong, so don't report it as a failure.
      // Any error message from this run is the abort itself, not the provider.
      pendingErrors = [];
      sender.enqueue(
        stoppedMessage({ panelId: conf.panel, agent: state.agent, wall: clock() }),
        { urgent: true },
      );
      return;
    }
    for (const error of pendingErrors) sender.enqueue(error, { urgent: true });
    pendingErrors = [];
    sender.enqueue(
      doneMessage({
        panelId: conf.panel,
        agent: state.agent,
        wall: clock(),
        text: state.closing,
      }),
      { urgent: true },
    );
  });

  pi.on("session_shutdown", async () => {
    // A run that never settled still owes its error line; post it before the
    // closing entry so the pair is not silently lost on shutdown.
    for (const error of pendingErrors) sender.enqueue(error, { urgent: true });
    pendingErrors = [];
    // Posted for every reason, reload included: the pair is the truth, and a
    // panel that stops mid-sentence with no closing line cannot be told apart
    // from one that crashed.
    sender.enqueue(
      sessionClosedMessage({ panelId: conf.panel, agent: state.agent, wall: clock() }),
      { urgent: true },
    );
    try {
      await sender.flush();
    } catch {
      // Already surfaced through handleSendError.
    }
  });

  // ---- commands ------------------------------------------------------------
  // OAuth login: run the CLI device-code flow, relay the code, open the
  // browser, and notify when the token is saved.
  let loginProc: ChildProcess | null = null;

  pi.registerCommand("pushtodisplay-login", {
    description: "Authenticate pi with Push To Display (OAuth device-code flow)",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      if (loginProc) {
        ctx.ui.notify("Push To Display login already in progress", "warning");
        return;
      }
      ctx.ui.notify("Starting Push To Display OAuth login…", "info");
      console.log("[pushtodisplay] starting OAuth device-code login…");

      const child = spawnCli(["auth", "login", "--device-code"]);
      loginProc = child;

      let opened = false;
      let shown = false;
      let out = "";

      child.stdout?.on("data", (d: Buffer) => {
        out += d.toString();
        const m = out.match(/https:\/\/idp\.pushtodisplay\.com\/device\?user_code=[A-Z0-9-]+/);
        const code = out.match(/(?:enter the code|user_code)[:\s]*([A-Z0-9]{4}-[A-Z0-9]{4})/);
        if (m && !opened) {
          opened = true;
          void openBrowser(m[0]);
        }
        if (code && !shown) {
          shown = true;
          ctx.ui.notify(`Approve in the opened browser tab — code: ${code[1]}`, "info");
        }
      });
      child.stderr?.on("data", (d: Buffer) => {
        console.error("[pushtodisplay]", d.toString().trim());
      });
      child.on("error", (e) => {
        loginProc = null;
        if (isCliMissing(e)) {
          ctx.ui.notify(`⚠️ ${cliNotFoundMessage()}`, "error");
        } else {
          ctx.ui.notify(`Failed to start login: ${e.message}`, "error");
        }
      });
      child.on("exit", (code) => {
        loginProc = null;
        if (code === 0) {
          void gate.start();
          authLostNotified = false;
          // The TUI already said so; posting it again costs a message.
          ctx.ui.notify("✅ Connected to Push To Display!", "info");
        } else {
          ctx.ui.notify(`Login failed/cancelled (exit ${code})`, "error");
        }
      });
    },
  });

  pi.registerCommand("pushtodisplay-status", {
    description: "Show Push To Display authentication status",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const authed = await gate.recheck();
      if (authed) {
        ctx.ui.notify("✅ Push To Display authenticated", "info");
      } else {
        ctx.ui.notify("⚠️ Push To Display not authenticated — run /pushtodisplay-login", "warning");
      }
    },
  });

  pi.registerCommand("pushtodisplay-test", {
    description: "Send a test update to your Push To Display board",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      // Probe on demand: right after a reload the cached flag is still false
      // while the session_start probe is in flight.
      if (!(await gate.allowed())) {
        ctx.ui.notify("⚠️ Not authenticated — run /pushtodisplay-login first", "warning");
        return;
      }
      try {
        await sendPayload(
          testMessage({ panelId: conf.panel, agent: state.agent, wall: clock() }),
          conf.boardId,
        );
        ctx.ui.notify("Test update sent", "info");
      } catch (err) {
        handleSendError(err);
        ctx.ui.notify("Test update failed — see log", "error");
      }
    },
  });

  pi.registerCommand("pushtodisplay-clear", {
    description: "Write a `log cleared` entry to this agent's panel",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      sender.enqueue(
        clearedMessage({ panelId: conf.panel, agent: state.agent, wall: clock() }),
        { urgent: true },
      );
      ctx.ui.notify("Panel cleared", "info");
    },
  });
}

function openBrowser(url: string) {
  const { platform } = process;
  if (platform === "darwin") return execFileAsync("open", [url]).catch(() => {});
  if (platform === "win32") return execFileAsync("cmd", ["/c", "start", "", url]).catch(() => {});
  return execFileAsync("xdg-open", [url]).catch(() => {});
}
