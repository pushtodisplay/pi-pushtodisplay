import { loadConfig, num, truncate, clock, MAX_PANEL, MIN_PANEL } from "../config.ts";

describe("loadConfig", () => {
  it("uses defaults when no env vars are set", () => {
    const c = loadConfig({});
    expect(c).toEqual({ boardId: "", panel: 1, label: "", disabled: false, steps: true });
  });

  it("reads board id, label, and disabled from the environment", () => {
    const c = loadConfig({
      PUSHTODISPLAY_BOARD_ID: "board-42",
      PUSHTODISPLAY_PANEL: "3",
      PUSHTODISPLAY_LABEL: "cicd",
      PUSHTODISPLAY_DISABLED: "1",
    });
    expect(c.boardId).toBe("board-42");
    expect(c.panel).toBe(3);
    expect(c.label).toBe("cicd");
    expect(c.disabled).toBe(true);
  });

  it("clamps an out-of-range panel to the default", () => {
    expect(loadConfig({ PUSHTODISPLAY_PANEL: "0" }).panel).toBe(1);
    expect(loadConfig({ PUSHTODISPLAY_PANEL: "9" }).panel).toBe(1);
    expect(loadConfig({ PUSHTODISPLAY_PANEL: "garbage" }).panel).toBe(1);
    expect(loadConfig({ PUSHTODISPLAY_PANEL: "2" }).panel).toBe(2);
  });
});

describe("num", () => {
  it("parses integers within [1, 4]", () => {
    expect(num("1", 1)).toBe(1);
    expect(num("4", 1)).toBe(4);
    expect(num(undefined, 2)).toBe(2);
  });
  it("rejects non-integers and out-of-range values", () => {
    expect(num("1.5", 1)).toBe(1);
    expect(num("", 1)).toBe(1);
    expect(num("5", 1)).toBe(1);
  });
  it("respects the exported panel bounds", () => {
    expect(MIN_PANEL).toBe(1);
    expect(MAX_PANEL).toBe(4);
  });
});

describe("truncate", () => {
  it("normalizes whitespace", () => {
    expect(truncate("  a\n   b  ", 100)).toBe("a b");
  });
  it("truncates with an ellipsis past the limit", () => {
    const out = truncate("x".repeat(200), 20);
    expect(out.length).toBe(20);
    expect(out.endsWith("…")).toBe(true);
  });
  it("keeps short strings untouched", () => {
    expect(truncate("hello", 20)).toBe("hello");
  });
});

describe("clock", () => {
  it("returns an HH:MM:SS timestamp", () => {
    expect(clock()).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});