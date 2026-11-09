/**
 * Load-time contract tests.
 *
 * pi runs the extension factory while only *registration* is legal: everything
 * backed by the extension runtime (pi.getSessionName(), pi.sendMessage(), ...)
 * is a stub that throws "Extension runtime not initialized" until pi binds the
 * runtime. Throwing there does not just fail one call — the whole factory is
 * discarded, so the extension vanishes and so do its slash commands.
 *
 * This is exactly how a rewrite of this extension silently unregistered every
 * `/pushtodisplay-*` command, so the fake `pi` below reproduces pi's gated
 * stubs instead of being permissive.
 */
import register from "../extension.ts";

type Handler = (event: never, ctx: never) => unknown;

const RUNTIME_ONLY = [
  "sendMessage",
  "sendUserMessage",
  "appendEntry",
  "setSessionName",
  "getSessionName",
  "setLabel",
  "getActiveTools",
  "getAllTools",
  "getSettings",
  "setActiveTools",
  "getCommands",
  "getThinkingLevel",
  "setThinkingLevel",
  "createContext",
] as const;

function fakePi() {
  const events = new Map<string, Handler[]>();
  const commands = new Map<string, { description?: string; handler: Handler }>();
  const runtimeCalls: string[] = [];

  const pi: Record<string, unknown> = {
    on(event: string, handler: Handler) {
      events.set(event, [...(events.get(event) ?? []), handler]);
      return () => {};
    },
    registerCommand(name: string, def: { description?: string; handler: Handler }) {
      commands.set(name, def);
    },
  };

  for (const method of RUNTIME_ONLY) {
    pi[method] = () => {
      runtimeCalls.push(method);
      throw new Error(
        "Extension runtime not initialized. Action methods cannot be called during extension loading.",
      );
    };
  }

  return { pi, events, commands, runtimeCalls };
}

describe("extension load", () => {
  it("initialises without touching runtime-backed APIs", () => {
    const { pi, runtimeCalls } = fakePi();
    expect(() => register(pi as never)).not.toThrow();
    expect(runtimeCalls).toEqual([]);
  });

  it("registers every documented slash command", () => {
    const { pi, commands } = fakePi();
    register(pi as never);
    expect([...commands.keys()].sort()).toEqual([
      "pushtodisplay-clear",
      "pushtodisplay-login",
      "pushtodisplay-setup",
      "pushtodisplay-status",
      "pushtodisplay-test",
    ]);
    for (const def of commands.values()) {
      expect(typeof def.handler).toBe("function");
      expect(def.description).toBeTruthy();
    }
  });

  it("subscribes to every event the message builders depend on", () => {
    const { pi, events } = fakePi();
    register(pi as never);
    for (const event of [
      "session_start",
      "session_info_changed",
      "before_agent_start",
      "tool_execution_start",
      "tool_execution_end",
      "message_end",
      "ui_prompt_start",
      "agent_settled",
      "session_shutdown",
    ]) {
      expect(events.get(event)?.length).toBeGreaterThan(0);
    }
  });
});
