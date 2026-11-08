import {
  createState,
  beginSession,
  beginTask,
  noteAssistant,
  type PanelState,
} from "../panel-state.ts";

const cwd = "/Users/me/proj";

const fresh = (): PanelState => createState({ agent: "release", cwd });

describe("state shape", () => {
  it("holds only fields a message builder reads", () => {
    // Pinned on purpose: a field that no builder reads is dead weight, and dead
    // weight is where the last three bugs lived. Adding one should be a
    // deliberate edit to this test.
    expect(Object.keys(fresh()).sort()).toEqual(
      ["agent", "closing", "cwd", "task"].sort(),
    );
  });
});

describe("session lifecycle", () => {
  it("forgets the task and the closing words on a fresh session", () => {
    const s = fresh();
    beginTask(s, "old task");
    noteAssistant(s, { role: "assistant", content: "Done with the old task." });

    beginSession(s);

    expect(s.task).toBe("");
    expect(s.closing).toBe("");
  });

  it("keeps the previous task when a custom-message run has no prompt", () => {
    const s = fresh();
    beginTask(s, "refactor the auth middleware");
    beginTask(s, "");
    expect(s.task).toBe("refactor the auth middleware");
  });

  it("keeps the prompt raw so paths can still be shortened later", () => {
    const s = fresh();
    const prompt = `/var/folders/${"x".repeat(120)}/pasted-image-20261106-114413.png`;
    beginTask(s, prompt);
    expect(s.task).toBe(prompt);
  });
});

describe("noteAssistant", () => {
  it("keeps the last text block, stripped of markdown", () => {
    const s = fresh();
    noteAssistant(s, {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check the tests." },
        { type: "toolCall", id: "1", name: "bash", arguments: {} },
        { type: "text", text: "## Summary\n**Pinned** the `clock` so it is deterministic." },
      ],
    });
    expect(s.closing).toBe("Pinned the clock so it is deterministic.");
  });

  it("drops code fences and ignores non-assistant messages", () => {
    const s = fresh();
    noteAssistant(s, {
      role: "assistant",
      content: [{ type: "text", text: "```ts\nconst a = 1\n```\nAll tests pass." }],
    });
    expect(s.closing).toBe("All tests pass.");
    noteAssistant(s, { role: "user", content: "do it" });
    expect(s.closing).toBe("All tests pass.");
  });

  it("is cleared when a new task arrives", () => {
    const s = fresh();
    noteAssistant(s, { role: "assistant", content: "Done with the old task." });
    beginTask(s, "next thing");
    expect(s.closing).toBe("");
  });
});
