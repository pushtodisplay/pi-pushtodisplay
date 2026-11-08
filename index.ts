/**
 * pi-pushtodisplay — package entry point.
 *
 * Resolves the bundled `pushtodisplay` CLI, then hands pi the extension factory
 * from `src/extension.ts` (see that file for what the board actually shows).
 *
 * This is the only file allowed to touch `import.meta`: it keeps the factory
 * importable from the CommonJS unit-test transform.
 */
import { createRequire } from "node:module";

import { configureCliResolver } from "./src/cli-adapter.ts";
import extension from "./src/extension.ts";

// Resolve the bundled `pushtodisplay` npm dependency relative to this package
// so installs via `pi install` are self-contained (no global CLI required).
// Resolved lazily by the adapter; falls back to a PATH binary if absent.
// Runs at module load, i.e. before pi invokes the factory.
const packageRequire = createRequire(import.meta.url);
configureCliResolver((id) => {
  try {
    return packageRequire.resolve(id);
  } catch {
    return undefined;
  }
});

export default extension;
