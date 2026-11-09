# Development and internal packaging

This document is for maintainers and contributors. The user install path is the
one in the README: `pi install npm:pi-pushtodisplay`, followed by
`/pushtodisplay-setup`.

## Local checkout

```bash
git clone https://github.com/pushtodisplay/pi-pushtodisplay.git
cd pi-pushtodisplay
npm ci
pi install "$PWD"
```

`npm ci` is only for development and tests; the published package is plain
TypeScript and needs no build step.

Project-scoped development installs (written to `.pi/settings.json`) are
available with `pi install -l "$PWD"`. They are a scope choice for contributors,
not a second user install path.

## Git source (pre-release builds)

To test an unreleased revision without publishing:

```bash
pi install git:github.com/pushtodisplay/pi-pushtodisplay
```

This is an alternative for maintainers. Normal users should install the npm
release.

## Vendored CLI

The npm `pushtodisplay` distribution includes an `npm-shrinkwrap.json` whose
dependency tree breaks `npm ci` with `EBADPLATFORM` on some platforms. The
package therefore vendors the pinned release under `vendor/pushtodisplay`
instead of declaring it as an npm dependency, so installs are reproducible.

Resolution order, internal only:

1. `vendor/pushtodisplay` (or an installed `node_modules/pushtodisplay` in a
   developer checkout),
2. a `pushtodisplay` binary on `PATH` as a resilience fallback.

Never document the CLI, npx, or a global install as a user step; users only need
`pi install` plus `/pushtodisplay-setup`.

To update the vendored release, follow [vendor/README.md](../vendor/README.md)
and keep `PUSHTODISPLAY_CLI_VERSION` in `src/cli-adapter.ts` in sync.

## Checks

```bash
npm run check        # typecheck + lint + test
npm test -- --coverage
```

## Release

See [publishing.md](publishing.md).
