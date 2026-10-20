# loophole-cli-builder

Builds and publishes the Loophole CLI (`@loophole-ai/cli`) from
[`loophole-ai/loophole-app`](https://github.com/loophole-ai/loophole-app).

This repo contains **only** release automation — no product code.

## What one run does

1. Checks out `loophole-ai/loophole-app` at the requested ref
2. Builds all **12** CLI targets on a Linux runner (Bun cross-compiles macOS/Windows)
3. Publishes the 12 platform packages, then the `@loophole-ai/cli` launcher (`latest` tag)
4. Packages `loophole-<target>.zip` / `.tar.gz` + `SHA256SUMS` + `install.sh`
5. Creates/updates GitHub release `v<version>` in `loophole-app`
6. Optionally updates `loophole-ai/homebrew-tap` (`Formula/loophole.rb`)

Bun and npm both install from the same registry packages, so `bun add -g @loophole-ai/cli`
works automatically once npm is published.

## Run it

Actions → **cli-builder** → *Run workflow*:

| Input | Default | Meaning |
|---|---|---|
| `version` | `1.0.5` | Version to build and publish |
| `ref` | `loophole` | Branch/tag/SHA of `loophole-app` |
| `publish_npm` | `true` | Publish to npm |
| `publish_release` | `true` | Create GitHub release + assets |
| `publish_homebrew` | `false` | Update the Homebrew tap |

Tag pushes (`v1.0.5`) run the same pipeline with npm and GitHub release enabled.
Homebrew stays off unless it is enabled explicitly on a manual run.

## Required secrets

| Secret | Scope | Used for |
|---|---|---|
| `NPM_TOKEN` | npm granular token, `@loophole-ai` scope, **2FA bypass on** | npm publish |
| `RELEASE_TOKEN` | GitHub fine-grained PAT: `contents: write` on `loophole-app` (and `homebrew-tap` if you enable Homebrew) | release assets, tap push |

`GITHUB_TOKEN` is not enough: this repo cannot write to `loophole-app`.

## Local usage

```bash
# after building in loophole-app: packages/cli/dist
APP_DIR=/path/to/loophole-app LOOPHOLE_VERSION=1.0.5 bun scripts/publish-cli.ts --dry-run
APP_DIR=/path/to/loophole-app LOOPHOLE_VERSION=1.0.5 bun scripts/archive.ts
```

## Install channels

| Channel | Command |
|---|---|
| npm | `npm i -g @loophole-ai/cli` |
| Bun | `bun add -g @loophole-ai/cli` |
| curl | `curl -fsSL https://github.com/loophole-ai/loophole-app/releases/latest/download/install.sh \| bash` |
| curl (main) | `curl -fsSL https://raw.githubusercontent.com/loophole-ai/cli-builder/main/install.sh \| bash` |
| Homebrew | `brew install loophole-ai/tap/loophole` |

## Notes

- Publishing is idempotent: already-published versions are skipped, so re-running after a
  partial failure is safe.
- The launcher is published **last**; it is refused unless all 12 platform packages are present
  (`CLI_ALLOW_PARTIAL=1` overrides for deliberate partial releases).
- AUR (`yay`/`paru`) is not automated yet: it needs an AUR account and SSH key.
- WinGet is not automated yet: it requires a manifest submission to `microsoft/winget-pkgs`.
