/**
 * Run-outcome regression tests.
 *
 * pi reports a user abort as an assistant message with `stopReason: "error"`
 * and the text "This operation was aborted", then emits `agent_settled` with
 * `aborted: true`. The extension must not turn that into a FAIL line: STOP is
 * the only verdict for a run the user cancelled.
 */
const mockSent: string[] = [];

jest.mock("../cli-adapter.ts", () => ({
  sendPayload: jest.fn(async (payload: { blocks: { text: string }[] }) => {
    mockSent.push(payload.blocks.map((b) => b.text).join(""));
  }),
  authStatus: jest.fn(async () => true),
  spawnCli: jest.fn(),
  isAuthFailure: () => false,
  isCliMissing: () => false,
  cliNotFoundMessage: () => "cli missing",
}));

import register from "../extension.ts";

type Handler = (event: never, ctx: never) => unknown;

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
  ctx: unknown = {},
) {
  for (const handler of events.get(name) ?? []) {
    await handler(event as never, ctx as never);
  }
}

const CTX = { cwd: "/tmp/demo", hasUI: false };

describe("run outcome", () => {
  beforeEach(() => {
    mockSent.length = 0;
  });

  it("does not post an aborted run's error message as FAIL", async () => {
    const { pi, events } = fakePi();
    register(pi as never);

    await emit(events, "session_start", { type: "session_start", reason: "startup" }, CTX);
    await emit(events, "message_end", {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "This operation was aborted",
      },
    });
    await emit(events, "agent_settled", { type: "agent_settled", aborted: true });
    await emit(events, "session_shutdown", { type: "session_shutdown", reason: "quit" });

    expect(mockSent.some((line) => line.includes("This operation was aborted"))).toBe(false);
    expect(mockSent.some((line) => line.includes("interrupted before it finished STOP"))).toBe(
      true,
    );
  }, 15000);

  it("still reports a provider error when the run was not aborted", async () => {
    const { pi, events } = fakePi();
    register(pi as never);

    await emit(events, "session_start", { type: "session_start", reason: "startup" }, CTX);
    await emit(events, "message_end", {
      type: "message_end",
      message: {
        role: "assistant",
        stopReason: "error",
        errorMessage: "HTTP 500 from provider",
      },
    });
    await emit(events, "agent_settled", { type: "agent_settled", aborted: false });
    await emit(events, "session_shutdown", { type: "session_shutdown", reason: "quit" });

    const errorAt = mockSent.findIndex((line) => line.includes("HTTP 500 from provider FAIL"));
    const doneAt = mockSent.findIndex((line) => line.includes(" DONE "));
    expect(errorAt).toBeGreaterThanOrEqual(0);
    expect(doneAt).toBeGreaterThan(errorAt);
  }, 15000);
});
