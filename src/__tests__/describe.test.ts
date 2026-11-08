import { cleanCommand, describeTool, shortenPath, MAX_DESC } from "../describe.ts";

const cwd = "/Users/me/proj";

describe("describeTool — bash", () => {
  it("uses the first command line with a present-tense verb", () => {
    expect(describeTool("bash", { command: "npm test\nnpm run lint" })).toBe("running npm test");
  });

  it("drops the leading cd guard, redirections, and | head boilerplate", () => {
    expect(describeTool("bash", { command: "cd /tmp && npm test 2>&1 | head -20" })).toBe(
      "running npm test",
    );
    expect(describeTool("bash", { command: "FOO=1 BAR=2 make build > /dev/null" })).toBe(
      "running make build",
    );
  });

  it("summarises a long command to its program", () => {
    expect(describeTool("bash", { command: `echo ${"y".repeat(200)}` })).toBe("running echo");
    // A command that fits is left alone; only an over-budget one is summarised.
    expect(describeTool("bash", { command: "grep -c TODO src/extension.ts" })).toBe(
      "running grep -c TODO src/extension.ts",
    );
    expect(
      describeTool("bash", { command: 'grep -rn "amber|BG_|ON_DARK" src/*.ts index.ts' }),
    ).toBe("running grep");
    expect(describeTool("bash", { command: "git push -u origin main" })).toBe(
      "running git push -u origin main",
    );
  });

  it("never exceeds the description budget", () => {
    const long = describeTool("bash", { command: `echo ${"y".repeat(200)}` });
    expect(long.length).toBeLessThanOrEqual(MAX_DESC);
  });
});

describe("describeTool — files", () => {
  it("shortens absolute paths against the cwd", () => {
    expect(describeTool("read", { path: `${cwd}/src/a.ts` }, { cwd })).toBe("reading src/a.ts");
    expect(describeTool("write", { path: `${cwd}/out/b.ts` }, { cwd })).toBe("writing out/b.ts");
    expect(describeTool("edit", { path: "src/index.ts" })).toBe("editing src/index.ts");
  });

  it("rewrites paths under $HOME as ~", () => {
    expect(shortenPath("/home/me/notes.md", { home: "/home/me" })).toBe("~/notes.md");
    // Outside the cwd and $HOME the leading directories are noise at 48 chars.
    expect(shortenPath("/var/log/x", { home: "/home/me" })).toBe("…/x");
  });

  it("appends a diff stat to edits", () => {
    const out = describeTool("edit", {
      path: "src/a.ts",
      oldText: "a\nb",
      newText: "a\nb\nc\nd",
    });
    expect(out).toBe("editing src/a.ts (+4 −2)");
  });

});

describe("describeTool — other tools", () => {
  it("describes searches and fetches", () => {
    expect(describeTool("grep", { pattern: "TODO", path: "src" })).toBe("searching for TODO in src");
    expect(describeTool("glob", { pattern: "**/*.ts" })).toBe("finding **/*.ts");
    expect(describeTool("web_search", { query: "pi packages" })).toBe(
      "searching the web for pi packages",
    );
    expect(describeTool("web_fetch", { url: "https://example.com/a" })).toBe("fetching example.com/a");
  });

  it("falls back to tool(arg: value) for unknown tools", () => {
    const out = describeTool("mcp_create_issue", { owner: "pushtodisplay", repo: "cli" });
    expect(out).toContain("mcp_create_issue(");
    expect(out).toContain("owner: pushtodisplay");
  });

  it("has sensible defaults for sparse args", () => {
    expect(describeTool("ls", {})).toBe("listing .");
    expect(describeTool("mystery", {})).toBe("mystery");
    expect(describeTool("mystery", undefined)).toBe("mystery");
  });
});

describe("cleanCommand", () => {
  it("normalises whitespace", () => {
    expect(cleanCommand("  npm   run   build  ")).toBe("npm run build");
  });
  it("returns empty for a blank command", () => {
    expect(cleanCommand("   \n  ")).toBe("");
  });
});
