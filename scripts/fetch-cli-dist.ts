#!/usr/bin/env bun
// Downloads one published CLI platform package from npm and lays it out like
// packages/cli/dist/cli-<target>, which is what the desktop prebuild expects.
// Using the published package means the desktop does not have to rebuild the CLI.
import { cp, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { $ } from "bun"

const version = process.env.CLI_VERSION ?? process.env.LOOPHOLE_VERSION ?? ""
const target = process.env.CLI_TARGET ?? ""
const out = process.env.OPENCODE_CLI_DIST ?? process.env.CLI_DIST ?? path.join(process.cwd(), "cli-dist")

const targets: Record<string, { package: string; os: string; cpu: string }> = {
  "aarch64-apple-darwin": { package: "@loophole-ai/cli-darwin-arm64", os: "darwin", cpu: "arm64" },
  "x86_64-apple-darwin": { package: "@loophole-ai/cli-darwin-x64-baseline", os: "darwin", cpu: "x64" },
  "x86_64-pc-windows-msvc": { package: "@loophole-ai/cli-windows-x64-baseline", os: "win32", cpu: "x64" },
  "x86_64-unknown-linux-gnu": { package: "@loophole-ai/cli-linux-x64-baseline", os: "linux", cpu: "x64" },
  "aarch64-unknown-linux-gnu": { package: "@loophole-ai/cli-linux-arm64", os: "linux", cpu: "arm64" },
}

const entry = targets[target]
if (!entry) throw new Error(`No CLI mapping for target: ${target || "<unset>"}`)
if (!version) throw new Error("CLI_VERSION is required")

const directory = await mkdtemp(path.join(tmpdir(), "loophole-cli-"))
try {
  await $`bun install --no-save --cwd ${directory} ${`${entry.package}@${version}`} ${`--os=${entry.os}`} ${`--cpu=${entry.cpu}`}`
  const source = path.join(directory, "node_modules", entry.package)
  const dest = path.join(out, entry.package.replace("@loophole-ai/", ""))
  await rm(dest, { recursive: true, force: true })
  await cp(source, dest, { recursive: true })
  const binary = path.join(dest, "bin", entry.os === "win32" ? "loophole.exe" : "loophole")
  if (!(await Bun.file(binary).exists())) throw new Error(`CLI binary missing after copy: ${binary}`)
  console.log(`prepared ${entry.package}@${version} -> ${dest}`)
} finally {
  await rm(directory, { recursive: true, force: true })
}
