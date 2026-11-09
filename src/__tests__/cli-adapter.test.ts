import {
  sendArgs,
  isAuthFailure,
  isCliMissing,
  resolveCli,
  configureCliResolver,
  authStatus,
  __resetCliCache,
} from "../cli-adapter.ts";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";

// Issue a fake `auth status` on stdout with the given exit code — the script
// body is scenario-specific so no child/environment sharing is needed.
function fakeCliBody(stdout = "", exitCode = 0): string {
  return (
    `process.stdout.write(${JSON.stringify(stdout)});\n` +
    `process.exit(${exitCode});\n`
  );
}

/** Create a fake `pushtodisplay` npm package whose bin maps to a fake CLI. */
function fakeCliPkg(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ptd-fakecli-"));
  writeFileSync(path.join(dir, "cli.js"), fakeCliBody());
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      name: "pushtodisplay",
      version: "0.0.0",
      bin: { pushtodisplay: "./cli.js" },
    }),
  );
  return path.join(dir, "package.json");
}

/** Re-point the fake cli we create at a specific body/exit-code behavior. */
function withFakeCli(body: string, exitCode = 0): void {
  const pkgJson = fakeCliPkg();
  writeFileSync(
    path.join(path.dirname(pkgJson), "cli.js"),
    fakeCliBody(body, exitCode),
  );
  configureCliResolver((id) =>
    id === "pushtodisplay/package.json" ? pkgJson : undefined,
  );
}
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Payload } from "../payloads.ts";

/** Create a fake pushtodisplay package dir; returns its package.json path. */
function fakePkg(opts: { bin?: string } = {}): string {
  const dir = mkdtempSync(path.join(tmpdir(), "ptd-pkg-"));
  if (opts.bin) {
    const p = path.join(dir, opts.bin);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, "#!/usr/bin/env node\n");
  }
  const manifest: Record<string, unknown> = { name: "pushtodisplay", version: "0.0.0" };
  if (opts.bin) manifest.bin = { pushtodisplay: opts.bin };
  const pkgJson = path.join(dir, "package.json");
  writeFileSync(pkgJson, JSON.stringify(manifest));
  return pkgJson;
}

function resolveFrom(pkgJsonPath: string) {
  configureCliResolver((id) =>
    id === "pushtodisplay/package.json" ? pkgJsonPath : undefined,
  );
}

describe("sendArgs", () => {
  const payload: Payload = {
    panelId: 2,
    background: "#1a5276",
    density: "compact",
    blocks: [{ text: "hi", color: "#ffffff" }],
  };

  it("maps a payload to CLI argv", () => {
    expect(sendArgs(payload, "board-1")).toEqual([
      "send",
      "-b",
      "board-1",
      "-p",
      "2",
      "--background",
      "#1a5276",
      "--density",
      "compact",
      "--block",
      '{"text":"hi","color":"#ffffff"}',
    ]);
  });

  it("omits -b when no board is configured", () => {
    expect(sendArgs({ panelId: 1, blocks: [{ text: "x" }] }, "")).toEqual([
      "send",
      "-p",
      "1",
      "--block",
      '{"text":"x"}',
    ]);
  });

  it("supports multiple blocks", () => {
    const args = sendArgs(
      { panelId: 1, blocks: [{ text: "a" }, { text: "b" }] },
      "",
    );
    expect(args.filter((a) => a === "--block")).toHaveLength(2);
  });

  it("omits optional flags that are not set", () => {
    const args = sendArgs({ panelId: 3, blocks: [{ text: "x" }] }, "");
    expect(args).toEqual(["send", "-p", "3", "--block", '{"text":"x"}']);
  });
});

describe("resolveCli", () => {
  afterEach(() => {
    configureCliResolver(null);
  });

  it("uses the bundled package when a resolver resolves it", () => {
    const pkgJson = fakePkg({ bin: "./dist/cli.js" });
    try {
      resolveFrom(pkgJson);
      const cmd = resolveCli();
      expect(cmd.source).toBe("bundled");
      expect(cmd.exe).toBe(process.execPath);
      expect(cmd.prefix).toEqual([path.join(path.dirname(pkgJson), "dist", "cli.js")]);
    } finally {
      rmSync(path.dirname(pkgJson), { recursive: true, force: true });
    }
  });

  it("resolves the vendored CLI shipped with the package", () => {
    const manifest = path.resolve(__dirname, "../../vendor/pushtodisplay/package.json");
    resolveFrom(manifest);
    const cmd = resolveCli();
    expect(cmd.source).toBe("bundled");
    expect(cmd.exe).toBe(process.execPath);
    expect(cmd.prefix).toEqual([
      path.resolve(__dirname, "../../vendor/pushtodisplay/dist/cli.js"),
    ]);
  });

  it("falls back to PATH when the dependency is missing", () => {
    configureCliResolver(() => undefined);
    const cmd = resolveCli();
    expect(cmd.source).toBe("path");
    expect(cmd.exe).toBe("pushtodisplay");
    expect(cmd.prefix).toEqual([]);
  });

  it("falls back to PATH when the package manifest has no bin", () => {
    const pkgJson = fakePkg(); // no bin field
    try {
      resolveFrom(pkgJson);
      const cmd = resolveCli();
      expect(cmd.source).toBe("path");
    } finally {
      rmSync(path.dirname(pkgJson), { recursive: true, force: true });
    }
  });

  it("falls back to PATH when the bin target file does not exist", () => {
    const pkgJson = fakePkg();
    try {
      // point at a bin path that was never created
      writeFileSync(
        pkgJson,
        JSON.stringify({ name: "pushtodisplay", bin: { pushtodisplay: "./missing.js" } }),
      );
      resolveFrom(pkgJson);
      const cmd = resolveCli();
      expect(cmd.source).toBe("path");
    } finally {
      rmSync(path.dirname(pkgJson), { recursive: true, force: true });
    }
  });

  it("caches the resolved command", () => {
    configureCliResolver(() => undefined);
    const a = resolveCli();
    const b = resolveCli();
    expect(a).toBe(b);
  });
});

describe("authStatus", () => {
  const jsonAuthed =
    JSON.stringify({
      authenticated: true,
      method: "oauth",
      accessTokenExpired: false,
      canRefresh: true,
    }) + "\n";
  const jsonRefreshable =
    JSON.stringify({
      authenticated: true,
      method: "oauth",
      accessTokenExpired: true,
      canRefresh: true,
    }) + "\n";
  const jsonUnauthed =
    JSON.stringify({
      authenticated: false,
      method: null,
      accessTokenExpired: false,
      canRefresh: false,
    }) + "\n";
  const legacyOk =
    "Auth method: OAuth (JWT)\nAll commands available (send, boards, devices).\n";
  const legacyDenied =
    "Not authenticated. Run `pushtodisplay auth login` to log in.\n";
  const legacyExpired =
    "Auth method: OAuth (JWT)\nAccess token expires: 2026-01-01T00:00:00.000Z (expired)\nAll commands available (send, boards, devices).\n";

  afterEach(() => {
    configureCliResolver(null);
    __resetCliCache();
  });

  it("returns true for a valid JSON-authed status", async () => {
    withFakeCli(jsonAuthed);
    await expect(authStatus()).resolves.toBe(true);
  });

  it("returns true when only the access token is expired but refresh is alive", async () => {
    withFakeCli(jsonRefreshable);
    await expect(authStatus()).resolves.toBe(true);
  });

  it("returns false for a JSON status that is not authenticated", async () => {
    withFakeCli(jsonUnauthed);
    await expect(authStatus()).resolves.toBe(false);
  });

  it("returns false when the CLI exits non-zero (not authenticated)", async () => {
    withFakeCli("", 1);
    await expect(authStatus()).resolves.toBe(false);
  });

  it("falls back to legacy heuristics for older CLIs (authenticated)", async () => {
    withFakeCli(legacyOk);
    await expect(authStatus()).resolves.toBe(true);
  });

  it("falls back to legacy heuristics for older CLIs (not authenticated)", async () => {
    withFakeCli(legacyDenied);
    await expect(authStatus()).resolves.toBe(false);
  });

  it("treats a legacy expired access token as denied", async () => {
    withFakeCli(legacyExpired);
    await expect(authStatus()).resolves.toBe(false);
  });
});

describe("error classification", () => {
  it("detects auth failures", () => {
    expect(isAuthFailure(new Error("401 Unauthorized"))).toBe(true);
    expect(isAuthFailure(new Error("403 Forbidden"))).toBe(true);
    expect(isAuthFailure(new Error("403"))).toBe(true);
    expect(isAuthFailure(new Error("unauthorized"))).toBe(true);
    expect(isAuthFailure(new Error("ECONNREFUSED"))).toBe(false);
  });

  it("detects a missing CLI binary via ENOENT", () => {
    expect(isCliMissing(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }))).toBe(true);
    expect(isCliMissing(new Error("spawn ENOENT"))).toBe(false);
  });
});