# CI/CD

## Policy

- GitHub Actions runs on pull requests, every branch push, `v*` tag pushes, and manual dispatch.
- The stable required result is the **CI result** job. It fails unless both the source job and Chromium E2E job succeed.
- Pull requests must pass source verification and Chromium extension E2E. Every run packages the extension so archive regressions are caught before merge; pushes to `main` retain the ZIP and checksum as candidate Actions artifacts.
- A `v*` tag must point to a commit reachable from `origin/main`, match `package.json`, rerun CI, and build a fresh WXT ZIP before an immutable GitHub Release is created with the ZIP and SHA-256 checksum.
- GitHub never submits to Chrome Web Store or Microsoft Edge Add-ons and never deploys this extension. Store publication remains a manual maintainer action.

Main artifacts are uploaded by the source job before browser verification finishes; treat them as candidates until the stable **CI result** job passes.

- Workflow permissions are read-only except the tag-only release job, which needs `contents: write` to create the GitHub Release. Workflows use `pnpm install --frozen-lockfile`, pinned Node `22.22.3`, the package-root `packageManager`, and full-length Action commit SHAs.

## Commands and boundaries

| Purpose | Command | Notes |
| --- | --- | --- |
| Source/type/test/build gate | `pnpm verify` | Used by CI before packaging. |
| Automatic browser gate | `pnpm test:e2e` | Rebuilds and loads `.output/chrome-mv3`; uploads Playwright reports on failure. |
| Main/package build | `pnpm zip` | Produces `.output/cqu-link-fix-<version>-chrome.zip`; CI records SHA-256. |
| Release validation | See `.github/workflows/ci.yml` | Validates tag/version/main ancestry, archive integrity, and checksum before release. |

The browser job covers local fixture E2E only. The two native optional-permission prompts and real school network/login matrix remain manual gates described in `README.md` and `docs/validation/live-smoke.md`. Passing CI is therefore not store acceptance.

Repository settings cannot be changed from this workflow: branch protection currently returns a permissions/plan restriction, so select **CI result** manually when protection becomes available. Until then, do not describe protection as configured.
