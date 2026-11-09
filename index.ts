/**
 * pi-pushtodisplay — package entry point.
 *
 * Resolves the vendored `pushtodisplay` CLI, then hands pi the extension
 * factory from `src/extension.ts` (see that file for what the board actually
 * shows).
 *
 * This is the only file allowed to touch `import.meta`: it keeps the factory
 * importable from the CommonJS unit-test transform.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { configureCliResolver } from "./src/cli-adapter.ts";
import extension from "./src/extension.ts";

// Resolve the bundled CLI relative to this package so `pi install` is
// self-contained (no separate CLI install). The vendored release is preferred;
// an installed dependency is still honoured for developer checkouts, and the
// adapter falls back to a PATH binary as a last resort.
const packageRoot = path.dirname(fileURLToPath(import.meta.url));
const vendoredManifest = path.join(packageRoot, "vendor", "pushtodisplay", "package.json");
const packageRequire = createRequire(import.meta.url);
configureCliResolver((id) => {
  if (id !== "pushtodisplay/package.json") return undefined;
  if (existsSync(vendoredManifest)) return vendoredManifest;
  try {
    return packageRequire.resolve(id);
  } catch {
    return undefined;
  }
});

export default extension;
