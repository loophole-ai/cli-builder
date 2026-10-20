#!/usr/bin/env bun
// Publishes the Loophole CLI to npm:
//   1. the 12 platform packages (@loophole-ai/cli-<target>)
//   2. the launcher (@loophole-ai/cli) that depends on them
// The launcher is always published last so `npm i -g @loophole-ai/cli` never
// points at a version whose platform packages are missing.
import { existsSync } from "node:fs"
import path from "node:path"
import { $ } from "bun"

const builder = path.resolve(import.meta.dir, "..")
const app = process.env.APP_DIR ?? path.resolve(builder, "../loophole-app")
const cliDir = path.join(app, "packages", "cli")
const dist = process.env.CLI_DIST ?? path.join(cliDir, "dist")
const version = process.env.LOOPHOLE_VERSION ?? ""
const tag = process.env.NPM_TAG ?? "latest"
const dryRun = process.argv.includes("--dry-run")

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error(`Invalid LOOPHOLE_VERSION: ${version || "<unset>"}`)
if (!existsSync(dist)) throw new Error(`CLI dist not found: ${dist}`)

const platformPackages = await Array.fromAsync(new Bun.Glob("cli-*/package.json").scan({ cwd: dist }))
const binaries: Record<string, string> = {}
for (const relative of platformPackages.toSorted()) {
  const pkg = await Bun.file(path.join(dist, relative)).json()
  if (typeof pkg.name !== "string" || !pkg.name.startsWith("@loophole-ai/cli-"))
    throw new Error(`Unexpected package in ${relative}: ${pkg.name}`)
  if (pkg.version !== version) throw new Error(`${pkg.name} is version ${pkg.version}, expected ${version}`)
  binaries[pkg.name] = version
}

const expected = 12
if (Object.keys(binaries).length !== expected && process.env.CLI_ALLOW_PARTIAL !== "1") {
  throw new Error(
    `Expected ${expected} platform packages in ${dist}, found ${Object.keys(binaries).length}.\n` +
      `Refusing to publish a launcher that is broken on the missing platforms.\n` +
      `Set CLI_ALLOW_PARTIAL=1 only for intentional partial releases.`,
  )
}

console.log(`version: ${version}`)
console.log(`dist:    ${dist}`)
console.log(`targets: ${Object.keys(binaries).join(", ")}`)

const launcherDir = path.join(dist, "cli")
await $`mkdir -p ${path.join(launcherDir, "bin")}`.quiet()
const postinstall = path.join(cliDir, "script", "postinstall.mjs")
if (!(await Bun.file(postinstall).exists())) throw new Error(`Missing postinstall script: ${postinstall}`)
await Bun.write(path.join(launcherDir, "postinstall.mjs"), Bun.file(postinstall))
await Bun.write(
  path.join(launcherDir, "bin", "loophole.exe"),
  [
    `echo "Error: @loophole-ai/cli's postinstall script was not run." >&2`,
    'echo "" >&2',
    'echo "This occurs when installation scripts are disabled." >&2',
    'echo "Reinstall with scripts enabled (npm config set ignore-scripts false)." >&2',
    "exit 1",
    "",
  ].join("\n"),
)
await Bun.write(
  path.join(launcherDir, "package.json"),
  JSON.stringify(
    {
      name: "@loophole-ai/cli",
      bin: { loophole: "./bin/loophole.exe", loophole2: "./bin/loophole.exe" },
      scripts: { postinstall: "node ./postinstall.mjs" },
      version,
      license: "AGPL-3.0",
      repository: { type: "git", url: "git+https://github.com/loophole-ai/loophole-app.git" },
      homepage: "https://github.com/loophole-ai/loophole-app",
      os: ["darwin", "linux", "win32"],
      cpu: ["arm64", "x64"],
      optionalDependencies: binaries,
    },
    null,
    2,
  ),
)

async function isPublished(name: string) {
  const result = await $`npm view ${name}@${version} version`.quiet().nothrow()
  return result.exitCode === 0
}

async function publish(dir: string, name: string) {
  if (!dryRun && (await isPublished(name))) {
    console.log(`already published ${name}@${version}`)
    return
  }
  console.log(`${dryRun ? "would publish" : "publishing"} ${name}@${version}`)
  if (dryRun) return
  const args = ["publish", "--access", "public", "--tag", tag]
  if (process.env.NPM_PROVENANCE === "true") args.push("--provenance")
  const result = await $`npm ${args}`.cwd(dir).nothrow()
  if (result.exitCode !== 0) throw new Error(`npm publish failed for ${name}\n${result.stderr.toString()}`)
}

for (const name of Object.keys(binaries).toSorted()) await publish(path.join(dist, name.replace("@loophole-ai/", "")), name)
await publish(launcherDir, "@loophole-ai/cli")

console.log(dryRun ? "dry run complete" : "npm publish complete")
