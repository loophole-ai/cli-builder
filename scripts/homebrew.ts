#!/usr/bin/env bun
// Regenerates Formula/loophole.rb in the Loophole Homebrew tap from the release
// archives, then commits and pushes it. The tap repo must already exist
// (https://github.com/loophole-ai/homebrew-tap) and the token needs contents:write
// on it. Missing tap is a warning, not a release failure.
import path from "node:path"
import { $ } from "bun"

const builder = path.resolve(import.meta.dir, "..")
const version = process.env.LOOPHOLE_VERSION ?? ""
const tag = process.env.TAG ?? `v${version}`
const appRepo = process.env.RELEASE_REPO ?? "loophole-ai/loophole-app"
const tapRepo = process.env.HOMEBREW_TAP ?? "loophole-ai/homebrew-tap"
const branch = process.env.HOMEBREW_BRANCH ?? "main"
const token = process.env.HOMEBREW_TAP_TOKEN ?? process.env.RELEASE_TOKEN
const assets = process.env.ASSETS_DIR ?? path.join(builder, "assets")

if (!version) throw new Error("LOOPHOLE_VERSION is required")
if (!token) throw new Error("HOMEBREW_TAP_TOKEN (or RELEASE_TOKEN) is required to update the tap")

const targets = {
  "darwin-arm64": `loophole-darwin-arm64.zip`,
  "darwin-x64-baseline": `loophole-darwin-x64-baseline.zip`,
  "linux-arm64": `loophole-linux-arm64.tar.gz`,
  "linux-x64-baseline": `loophole-linux-x64-baseline.tar.gz`,
} as const

const sums = new Map<string, string>()
for (const [target, file] of Object.entries(targets)) {
  const asset = path.join(assets, file)
  if (!(await Bun.file(asset).exists())) {
    console.warn(`::warning::Missing Homebrew asset ${file}; skipping tap update`)
    process.exit(0)
  }
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(await Bun.file(asset).arrayBuffer())
  sums.set(target, hash.digest("hex"))
}

const url = (file: string) => `https://github.com/${appRepo}/releases/download/${tag}/${file}`

const formula = `class Loophole < Formula
  desc "Open-source AI coding agent for the terminal"
  homepage "https://github.com/${appRepo}"
  version "${version}"
  license "AGPL-3.0-only"

  on_macos do
    if Hardware::CPU.arm?
      url "${url("loophole-darwin-arm64.zip")}"
      sha256 "${sums.get("darwin-arm64")}"
    else
      url "${url("loophole-darwin-x64-baseline.zip")}"
      sha256 "${sums.get("darwin-x64-baseline")}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${url("loophole-linux-arm64.tar.gz")}"
      sha256 "${sums.get("linux-arm64")}"
    else
      url "${url("loophole-linux-x64-baseline.tar.gz")}"
      sha256 "${sums.get("linux-x64-baseline")}"
    end
  end

  def install
    bin.install "loophole"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/loophole --version")
  end
end
`

const work = path.join(builder, ".homebrew-tap")
await $`rm -rf ${work}`.quiet()
const clone = await $`git clone --depth 1 ${`https://x-access-token:${token}@github.com/${tapRepo}.git`} ${work}`
  .quiet()
  .nothrow()
if (clone.exitCode !== 0) {
  console.warn(`::warning::Could not clone ${tapRepo}; create the tap repo first. Skipping Homebrew.`)
  process.exit(0)
}

await $`mkdir -p ${path.join(work, "Formula")}`.quiet()
await Bun.write(path.join(work, "Formula", "loophole.rb"), formula)
await $`git add Formula/loophole.rb`.cwd(work)
await $`git -c user.name=loophole-bot -c user.email=bot@loophole.ai commit -m ${`loophole ${version}`}`.cwd(work).nothrow()
const push = await $`git push origin ${`HEAD:${branch}`}`.cwd(work).nothrow()
if (push.exitCode !== 0) throw new Error(`Failed to push tap update\n${push.stderr.toString()}`)

console.log(`brew install ${tapRepo.split("/")[0]}/tap/loophole  # updated to ${version}`)
