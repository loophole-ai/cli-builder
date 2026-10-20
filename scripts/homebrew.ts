#!/usr/bin/env bun
// Regenerates Formula/loophole.rb in the Loophole Homebrew tap and pushes it.
// Uses GitHub release archives when they exist; otherwise falls back to the
// immutable npm tarballs so Homebrew works even without a GitHub release.
import path from "node:path"
import { $ } from "bun"

const builder = path.resolve(import.meta.dir, "..")
const version = process.env.LOOPHOLE_VERSION ?? ""
const tag = process.env.TAG ?? `v${version}`
const sourceRepo = process.env.SOURCE_REPO ?? "loophole-ai/loophole-app"
const downloadRepo = process.env.RELEASE_REPO ?? "loophole-ai/cli"
const tapRepo = process.env.HOMEBREW_TAP ?? "loophole-ai/homebrew-tap"
const token = process.env.HOMEBREW_TAP_TOKEN ?? process.env.RELEASE_TOKEN
const assets = process.env.ASSETS_DIR ?? path.join(builder, "assets")

if (!version) throw new Error("LOOPHOLE_VERSION is required")
const dryRun = process.argv.includes("--dry-run")
if (!token && !dryRun) throw new Error("HOMEBREW_TAP_TOKEN (or RELEASE_TOKEN) is required to update the tap")

const targets = [
  { target: "darwin-arm64", pkg: "cli-darwin-arm64", file: "loophole-darwin-arm64.zip" },
  { target: "darwin-x64-baseline", pkg: "cli-darwin-x64-baseline", file: "loophole-darwin-x64-baseline.zip" },
  { target: "linux-arm64", pkg: "cli-linux-arm64", file: "loophole-linux-arm64.tar.gz" },
  { target: "linux-x64-baseline", pkg: "cli-linux-x64-baseline", file: "loophole-linux-x64-baseline.tar.gz" },
]

async function sha256(buffer: ArrayBuffer) {
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(buffer)
  return hash.digest("hex")
}

const resolved = await Promise.all(
  targets.map(async (item) => {
    const asset = path.join(assets, item.file)
    if (await Bun.file(asset).exists()) {
      return {
        ...item,
        url: `https://github.com/${downloadRepo}/releases/download/${tag}/${item.file}`,
        sha256: await sha256(await Bun.file(asset).arrayBuffer()),
      }
    }

    const file = `${item.pkg}-${version}.tgz`
    const url = `https://registry.npmjs.org/@loophole-ai/${item.pkg}/-/${file}`
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`)
    return { ...item, url, sha256: await sha256(await response.arrayBuffer()) }
  }),
)

const byTarget = (target: string) => {
  const item = resolved.find((entry) => entry.target === target)
  if (!item) throw new Error(`Missing Homebrew target: ${target}`)
  return item
}

const macArm = byTarget("darwin-arm64")
const macIntel = byTarget("darwin-x64-baseline")
const linuxArm = byTarget("linux-arm64")
const linuxIntel = byTarget("linux-x64-baseline")

const formula = `class Loophole < Formula
  desc "Open-source AI coding agent for the terminal"
  homepage "https://github.com/${sourceRepo}"
  version "${version}"
  license "AGPL-3.0-only"

  on_macos do
    if Hardware::CPU.arm?
      url "${macArm.url}"
      sha256 "${macArm.sha256}"
    else
      url "${macIntel.url}"
      sha256 "${macIntel.sha256}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${linuxArm.url}"
      sha256 "${linuxArm.sha256}"
    else
      url "${linuxIntel.url}"
      sha256 "${linuxIntel.sha256}"
    end
  end

  def install
    if File.exist?("package/bin/loophole")
      bin.install "package/bin/loophole" => "loophole"
    else
      bin.install "loophole"
    end
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/loophole --version")
  end
end
`

const work = path.join(builder, ".homebrew-tap")
if (dryRun) {
  console.log(formula)
  process.exit(0)
}
await $`rm -rf ${work}`.quiet()
const clone = await $`git clone --depth 1 ${`https://x-access-token:${token}@github.com/${tapRepo}.git`} ${work}`
  .quiet()
  .nothrow()
if (clone.exitCode !== 0) {
  console.warn(`::warning::Could not clone ${tapRepo}; create the tap repo first. Skipping Homebrew.`)
  process.exit(0)
}

const branch = (await $`git branch --show-current`.cwd(work).quiet().text()).trim() || "main"
await $`mkdir -p ${path.join(work, "Formula")}`.quiet()
await Bun.write(path.join(work, "Formula", "loophole.rb"), formula)
await $`git add Formula/loophole.rb`.cwd(work)
const changed = (await $`git diff --cached --quiet`.cwd(work).nothrow()).exitCode !== 0
if (changed) {
  await $`git -c user.name=loophole-bot -c user.email=bot@loophole.ai commit -m ${`loophole ${version}`}`.cwd(work)
  const push = await $`git push origin ${`HEAD:${branch}`}`.cwd(work).nothrow()
  if (push.exitCode !== 0) throw new Error(`Failed to push tap update\n${push.stderr.toString()}`)
  console.log(`tap updated to ${version}`)
} else {
  console.log(`tap already at ${version}`)
}

console.log(`brew install ${tapRepo.split("/")[0]}/tap/loophole`)
