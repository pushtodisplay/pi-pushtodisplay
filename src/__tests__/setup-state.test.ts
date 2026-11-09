/**
 * Per-pi setup marker.
 *
 * The marker is the difference between "a credential exists on this machine"
 * and "this pi integration has completed its own setup". It lives under the
 * pi namespace so a marker from Codex (or any other integration) cannot enable
 * this package.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import {
  SETUP_VERSION,
  cacheDir,
  isSetupComplete,
  markSetupComplete,
  setupPath,
} from "../setup-state.ts";

function tempEnv(): { root: string; env: NodeJS.ProcessEnv; cleanup: () => void } {
  const root = mkdtempSync(path.join(tmpdir(), "ptd-pi-setup-"));
  return {
    root,
    env: { ...process.env, PUSHTODISPLAY_PI_CACHE_DIR: root },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

describe("setup-state", () => {
  it("is incomplete until the marker is written, then records details atomically", () => {
    const { env, cleanup } = tempEnv();
    try {
      expect(isSetupComplete(env)).toBe(false);
      const record = markSetupComplete(
        { boardId: "board-1", panel: 2, label: "release", cliVersion: "0.1.19" },
        env,
      );
      expect(record.version).toBe(SETUP_VERSION);
      expect(record.integration).toBe("pi");
      expect(record.boardId).toBe("board-1");
      expect(record.panel).toBe(2);
      expect(record.label).toBe("release");
      expect(isSetupComplete(env)).toBe(true);
      const onDisk = JSON.parse(readFileSync(setupPath(env), "utf8"));
      expect(onDisk.completedAt).toBe(record.completedAt);
      expect(onDisk.integration).toBe("pi");
    } finally {
      cleanup();
    }
  });

  it("ignores malformed markers and markers from another setup version", () => {
    const { root, env, cleanup } = tempEnv();
    try {
      writeFileSync(path.join(root, "setup.json"), "not json");
      expect(isSetupComplete(env)).toBe(false);
      writeFileSync(
        path.join(root, "setup.json"),
        JSON.stringify({ version: 0, completedAt: 1 }),
      );
      expect(isSetupComplete(env)).toBe(false);
      writeFileSync(
        path.join(root, "setup.json"),
        JSON.stringify({ version: SETUP_VERSION }),
      );
      expect(isSetupComplete(env)).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("is isolated from another integration's marker on the same machine", () => {
    const root = mkdtempSync(path.join(tmpdir(), "ptd-pi-host-"));
    const cache = path.join(root, "cache");
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: root,
      XDG_CACHE_HOME: cache,
    };
    delete env.PUSHTODISPLAY_PI_CACHE_DIR;
    try {
      expect(cacheDir(env)).toBe(path.join(cache, "pushtodisplay", "pi"));
      expect(setupPath(env)).toBe(
        path.join(cache, "pushtodisplay", "pi", "setup.json"),
      );

      // A Codex-style marker in the sibling namespace is not ours.
      const codexDir = path.join(cache, "pushtodisplay", "codex");
      mkdirSync(codexDir, { recursive: true });
      writeFileSync(
        path.join(codexDir, "setup.json"),
        JSON.stringify({ version: SETUP_VERSION, completedAt: Date.now() }),
      );
      expect(isSetupComplete(env)).toBe(false);

      markSetupComplete({ panel: 1 }, env);
      expect(isSetupComplete(env)).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
