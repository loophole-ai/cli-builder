# Loophole release builder

Builds and publishes the Loophole **CLI** (`@loophole-ai/cli`) and the
**desktop app** from [`loophole-ai/loophole-app`](https://github.com/loophole-ai/loophole-app).

This repo contains **only** release automation — no product code.

## Workflows

| Workflow | What it does |
|---|---|
| `cli-builder` | Builds 12 CLI targets, publishes npm packages, packages archives, creates the GitHub release |
| `desktop-builder` | Packages macOS/Windows/Linux installers, creates the desktop release with updater manifests |
| `homebrew` | Updates `loophole-ai/homebrew-tap` from npm tarballs (no rebuild, no release needed) |

## CLI (`cli-builder`)

Inputs: `version` (e.g. `1.0.5`), `ref` (default `loophole`), `publish_npm`,
`publish_release`, `publish_homebrew`.

1. Builds all 12 targets on Linux (Bun cross-compiles macOS/Windows)
2. Publishes the 12 platform packages, then the `@loophole-ai/cli` launcher (`latest` tag)
3. Packages `loophole-<target>.zip` / `.tar.gz` + `SHA256SUMS` + `install.sh`
4. Creates/updates GitHub release `v<version>` in `loophole-app`
5. Optionally updates the Homebrew tap

Tag pushes (`v1.0.5`) run the same pipeline with npm + release enabled.

## Desktop (`desktop-builder`)

Inputs: `version` (e.g. `1.0.0`), `cli_version` (published CLI to bundle),
`ref`, `publish_release`.

Matrix (native runners — installers cannot be cross-built):

| Target | Runner |
|---|---|
| `aarch64-apple-darwin` | `macos-14` |
| `x86_64-apple-darwin` | `macos-14` (`--x64`) |
| `x86_64-pc-windows-msvc` | `windows-latest` |
| `x86_64-unknown-linux-gnu` | `ubuntu-latest` |
| `aarch64-unknown-linux-gnu` | `ubuntu-24.04-arm` |

Each job downloads the published CLI platform package from npm, runs
`packages/desktop/scripts/prepare.ts` → `electron-vite build` → `electron-builder`,
then uploads installers and `latest*.yml` manifests. A final job creates release
`v<version>` with everything attached.

### Important: the updater reads `releases/latest`

The app's updater provider is:

```
https://github.com/loophole-ai/loophole-app/releases/latest/download
```

It fetches `latest.yml`, `latest-mac.yml`, `latest-linux.yml`,
`latest-linux-arm64.yml` from the **latest** release. Therefore:

- Desktop releases **must** include the `latest*.yml` assets.
- Any future CLI release must be marked **pre-release**, otherwise it becomes
  "latest" and desktop updates break with a 404.
- Alternatively, point the updater at a moving tag such as `desktop-latest`.

### Signing

Desktop builds are **unsigned** by default:

- macOS: signing/notarization are skipped when no Apple credentials exist
  (`CSC_IDENTITY_AUTO_DISCOVERY=false`). Users must right-click → **Open**.
- Windows: `script/sign-windows.ps1` skips itself when Azure Trusted Signing
  secrets are absent. Users see a SmartScreen prompt.
- Linux: unsigned by design.

To sign later, add the Apple certificate/API key and Azure Trusted Signing
secrets and drop `CSC_IDENTITY_AUTO_DISCOVERY`.

## Homebrew (`homebrew`)

Manual workflow, input `version`. Regenerates `Formula/loophole.rb` and pushes it
to `loophole-ai/homebrew-tap` (must exist and be **public**).

Uses GitHub release archives when `assets/loophole-*.{zip,tar.gz}` exist,
otherwise falls back to the immutable npm tarballs — so it works without a
GitHub release.

```bash
brew install loophole-ai/tap/loophole
```

## Required secrets

| Secret | Scope | Used by |
|---|---|---|
| `NPM_TOKEN` | npm granular token, `@loophole-ai`, read/write, **2FA bypass on** | cli-builder |
| `RELEASE_TOKEN` | GitHub fine-grained PAT, `contents: write` on `loophole-app` (and `homebrew-tap` for brew) | cli-builder, desktop-builder, homebrew |
| `HOMEBREW_TAP_TOKEN` | optional, overrides `RELEASE_TOKEN` for the tap | homebrew |

`GITHUB_TOKEN` alone is not enough: this repo cannot write to `loophole-app`.

## Local usage

```bash
# CLI publish (after building packages/cli/dist in loophole-app)
APP_DIR=/path/to/loophole-app LOOPHOLE_VERSION=1.0.5 bun scripts/publish-cli.ts --dry-run

# Homebrew formula preview
LOOPHOLE_VERSION=1.0.5 ASSETS_DIR=/path/to/assets bun scripts/homebrew.ts --dry-run

# Desktop release preview (lists the assets it would upload)
LOOPHOLE_VERSION=1.0.0 DESKTOP_DIST=/path/to/assets GH_TOKEN=dummy \
  bun scripts/desktop-release.ts --dry-run
```

## Install channels

| Channel | Command |
|---|---|
| npm | `npm i -g @loophole-ai/cli` |
| Bun | `bun add -g @loophole-ai/cli` |
| curl | `curl -fsSL https://raw.githubusercontent.com/loophole-ai/cli-builder/main/install.sh \| bash` |
| Homebrew | `brew install loophole-ai/tap/loophole` |

## Notes

- Publishing is idempotent: already-published versions are skipped, so re-running
  after a partial failure is safe.
- The launcher is published **last** and is refused unless all 12 platform
  packages are present (`CLI_ALLOW_PARTIAL=1` overrides for deliberate partial
  releases).
- AUR (`yay`/`paru`) is not automated: it needs an AUR account and SSH key.
- WinGet is not automated: it requires a `microsoft/winget-pkgs` submission.
- Renaming this repo is safe; only the raw `install.sh` URL in the table above
  changes.
