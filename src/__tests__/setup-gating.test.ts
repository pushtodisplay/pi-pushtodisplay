/**
 * Setup gating and the explicit setup flow.
 *
 * The extension may send only when BOTH are true:
 *   - the shared credential is valid, AND
 *   - this pi integration's setup marker exists.
 *
 * A fresh install on a machine already logged in through Codex/opencode/pi must
 * therefore stay silent until `/pushtodisplay-setup` completes.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const mockSent: string[] = [];
let mockAuthed = true;

jest.mock("../cli-adapter.ts", () => ({
  sendPayload: jest.fn(async (payload: { blocks: { text: string }[] }) => {
    mockSent.push(payload.blocks.map((b) => b.text).join(""));
  }),
  authStatus: jest.fn(async () => mockAuthed),
  spawnCli: jest.fn(),
  isAuthFailure: () => false,
  isCliMissing: () => false,
  cliNotFoundMessage: () => "cli missing",
  PUSHTODISPLAY_CLI_VERSION: "0.0.0-test",
}));

import register from "../extension.ts";
import type { Config } from "../config.ts";
import { setupIntegration } from "../setup.ts";
import { isSetupComplete, markSetupComplete } from "../setup-state.ts";

type Handler = (event: never, ctx: never) => unknown;

const CTX = { cwd: "/tmp/demo", hasUI: false };

function fakePi() {
  const events = new Map<string, Handler[]>();
  const pi: Record<string, unknown> = {
    on(event: string, handler: Handler) {
      events.set(event, [...(events.get(event) ?? []), handler]);
      return () => {};
    },
    registerCommand() {},
    getSessionName: () => "",
  };
  return { pi, events };
}

async function emit(
  events: Map<string, Handler[]>,
  name: string,
  event: unknown,
  ctx: unknown = CTX,
) {
  for (const handler of events.get(name) ?? []) {
    await handler(event as never, ctx as never);
  }
}

const config: Config = {
  boardId: "board-9",
  panel: 2,
  label: "ci",
  disabled: false,
  steps: true,
};

describe("setup gating", () => {
  const previousCache = process.env.PUSHTODISPLAY_PI_CACHE_DIR;
  let cacheRoot: string;

  beforeEach(() => {
    mockSent.length = 0;
    mockAuthed = true;
    cacheRoot = mkdtempSync(path.join(tmpdir(), "ptd-pi-gate-"));
    process.env.PUSHTODISPLAY_PI_CACHE_DIR = cacheRoot;
  });

  afterEach(() => {
    if (previousCache === undefined) delete process.env.PUSHTODISPLAY_PI_CACHE_DIR;
    else process.env.PUSHTODISPLAY_PI_CACHE_DIR = previousCache;
    rmSync(cacheRoot, { recursive: true, force: true });
  });

  it("does not send when auth is valid but the pi setup marker is missing", async () => {
    const { pi, events } = fakePi();
    register(pi as never);

    await emit(events, "session_start", { type: "session_start", reason: "startup" });
    await emit(events, "session_shutdown", { type: "session_shutdown", reason: "quit" });

    expect(mockSent).toEqual([]);
    expect(isSetupComplete(process.env)).toBe(false);
  });

  it("setup sends a test entry and writes the marker after it succeeds", async () => {
    const result = await setupIntegration({
      login: async () => {
        throw new Error("login should not run when auth is already valid");
      },
      config,
      label: "ci",
      env: process.env,
    });

    expect(result.ok).toBe(true);
    expect(mockSent).toHaveLength(1);
    expect(mockSent[0]).toMatch(/^ci link OK, panel 2 OK \d{2}:\d{2}$/);
    expect(isSetupComplete(process.env)).toBe(true);
  });

  it("logs in when needed, then sends the test and marks setup complete", async () => {
    mockAuthed = false;
    let logins = 0;

    const result = await setupIntegration({
      login: async () => {
        logins += 1;
        mockAuthed = true;
        return true;
      },
      config,
      label: "ci",
      env: process.env,
    });

    expect(logins).toBe(1);
    expect(result.ok).toBe(true);
    expect(mockSent).toHaveLength(1);
    expect(isSetupComplete(process.env)).toBe(true);
  });

  it("does not write the marker when the test entry fails", async () => {
    const result = await setupIntegration({
      login: async () => true,
      config,
      label: "ci",
      env: process.env,
      send: async () => {
        throw new Error("network down");
      },
    });

    expect(result.ok).toBe(false);
    expect(isSetupComplete(process.env)).toBe(false);
  });

  it("sends when both the marker and valid auth are present", async () => {
    markSetupComplete({ boardId: "board-9", panel: 2, label: "ci" }, process.env);
    const { pi, events } = fakePi();
    register(pi as never);

    await emit(events, "session_start", { type: "session_start", reason: "startup" });
    await emit(events, "session_shutdown", { type: "session_shutdown", reason: "quit" });

    expect(mockSent.some((line) => line.includes("session opened READY"))).toBe(true);
    expect(mockSent.some((line) => line.includes("session closed ENDED"))).toBe(true);
  });

  it("drops sends when the marker exists but auth is invalid", async () => {
    markSetupComplete({ boardId: "board-9", panel: 2, label: "ci" }, process.env);
    mockAuthed = false;
    const { pi, events } = fakePi();
    register(pi as never);

    await emit(events, "session_start", { type: "session_start", reason: "startup" });
    await emit(events, "session_shutdown", { type: "session_shutdown", reason: "quit" });

    expect(mockSent).toEqual([]);
  });
});
