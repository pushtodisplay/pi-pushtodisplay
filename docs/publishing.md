# Publishing pi-pushtodisplay

The package is distributed through npm. Pi discovers it from the `pi-package`
keyword in `package.json`; there is no separate catalog submission form. The
catalog page is:

<https://pi.dev/packages/pi-pushtodisplay>

**Current state:** `pi-pushtodisplay@0.2.2` is published on npm with a
provenance attestation. The first-publish section below is retained for
reference. Future releases use the configured Trusted Publisher.

## First publish (completed for 0.2.1)

npm Trusted Publishing can only be configured after the package exists, so the
first publish used a local npm login with 2FA. npm briefly showed a temporary
`0.0.0-stage` placeholder while the new package was processed; `0.2.1` became
the `latest` version once processing completed.

### Option A: publish from a trusted machine

```bash
npm login --auth-type=legacy
npm whoami                 # must print your npm username
npm run check
npm pack --dry-run         # confirm the tarball contains no tests
npm publish --access public --tag latest
npm view pi-pushtodisplay version
```

If npm opens a broken `/auth/cli/...` web-2FA page instead of prompting for an
OTP, pass the current authenticator code explicitly:

```bash
npm publish --access public --tag latest --otp=<current-code>
```

`prepublishOnly` runs `npm run check` again. Do not add `--provenance` to a
local publish: npm can only generate provenance from a supported cloud CI
runner.

### Option B: publish from GitHub Actions with a token

1. Create a granular npm access token with read/write access, scoped to
   `pi-pushtodisplay` (or **All packages** if the package is still new). If the
   account requires 2FA for writes, enable the token's 2FA bypass.
2. Add it as the repository secret `NPM_TOKEN` in
   `pushtodisplay/pi-pushtodisplay`.
3. Run **Actions → pi-pushtodisplay Publish → Run workflow** on `main`:
   - `release_type`: `stable`
   - `version_bump`: `none` (publishes the current `package.json` version)
   - `use_npm_token`: `true`
   - `dry_run`: `false`

The workflow defaults to Trusted Publishing (OIDC). Set `use_npm_token: true`
only for a package that does not have a Trusted Publisher yet; that path uses
`NPM_TOKEN` but still produces provenance on GitHub-hosted runners.

## Configure Trusted Publishing (before the next release)

The package now exists on npm. Create the Trusted Publisher only when you are
ready to cut the next release, because npm expires an unverified configuration
after 2 days.

In npm, open **Packages → pi-pushtodisplay → Settings → Trusted publishing**,
choose **GitHub Actions**, and enter:

| Field | Value |
| --- | --- |
| Organization or user | `pushtodisplay` |
| Repository | `pi-pushtodisplay` |
| Workflow filename | `pi-pushtodisplay-publish.yaml` |
| Environment name | *(leave empty)* |
| Allowed actions | allow **npm publish** (direct publishing) |

The same configuration can be created from an interactive terminal with
npm 11.15+ (it prompts for 2FA):

```bash
npx --yes npm@11.21.2 trust github pi-pushtodisplay \
  --file pi-pushtodisplay-publish.yaml \
  --repository pushtodisplay/pi-pushtodisplay \
  --allow-publish --yes
```

Save the configuration and complete an OIDC publish within 2 days; npm expires
an unverified configuration. The workflow lives at
`.github/workflows/pi-pushtodisplay-publish.yaml` and already has
`id-token: write`.

Once an OIDC publish succeeds:

1. Delete the `NPM_TOKEN` secret (repository or organization scope).
2. In npm package settings, set **Publishing access** to
   **Require two-factor authentication and disallow tokens**.
3. Revoke any token used for the first publish.

## Ongoing releases

1. Add the next version's entry to `CHANGELOG.md` and commit it to `main`.
   To see the exact next version, run the workflow once with `dry_run: true`;
   a stable `patch` release increments the patch number.
2. Run **Actions → pi-pushtodisplay Publish → Run workflow**:
   - `release_type`: `stable` (or `alpha` / `beta` / `rc`)
   - `version_bump`: `patch` (or `minor` / `major`)
   - `use_npm_token`: leave `false` for Trusted Publishing
   - `dry_run`: `false`
3. The workflow:
   - runs `npm ci` and `npm run check`
   - computes the version, updates `package.json` and `package-lock.json`
   - verifies the tarball and rejects it if `src/__tests__` is included
   - publishes with provenance (`latest` for stable; the release type for
     pre-releases)
   - commits the version bump and creates the
     `pi-pushtodisplay-vX.Y.Z` git tag
   - verifies the version on the npm registry

## Manual release fallback

If Actions is unavailable after the first publish:

```bash
npm version patch --no-git-tag-version
npm run check
npm publish --access public
npm view pi-pushtodisplay version

git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: release v$(node -p "require('./package.json').version")"
git tag "pi-pushtodisplay-v$(node -p "require('./package.json').version")"
git push origin main --follow-tags
```

A manual publish does not produce npm provenance.

## Verify the release

```bash
npm view pi-pushtodisplay version
npm view pi-pushtodisplay keywords --json   # must include "pi-package"
```

Check the catalog page after npm propagation:

```bash
curl -I https://pi.dev/packages/pi-pushtodisplay
```

Catalog indexing is automatic and can lag behind npm. Then test a clean install
without touching your personal Pi settings:

```bash
TMP_HOME=$(mktemp -d)
HOME="$TMP_HOME" pi install npm:pi-pushtodisplay
HOME="$TMP_HOME" pi list
```

## Troubleshooting

- **`E404` from `npm view`** — the package has not been published yet.
- **`ENEEDAUTH` during an OIDC publish** — the Trusted Publisher is missing or
  does not match exactly: repository `pushtodisplay/pi-pushtodisplay`, workflow
  filename `pi-pushtodisplay-publish.yaml`, `id-token: write`, and direct
  `npm publish` allowed. Self-hosted runners are not supported.
- **`403` with a token** — the granular token lacks write access to this
  package, or its 2FA bypass is not enabled.
- **`E403` "You cannot publish over the previously published versions"** — the
  version already exists. Use `version_bump: patch` (or edit the version), not
  `none`.
- **Release commit cannot push to `main`** — the workflow publishes first, then
  pushes the version commit and tag with `GITHUB_TOKEN`. If `main` is protected,
  allow GitHub Actions to bypass the rule or perform the version bump and tag
  manually after the registry publish succeeds.
- **Catalog page still 404** — npm accepted the package but the Pi crawler has
  not indexed it yet. Confirm the `pi-package` keyword is present.
