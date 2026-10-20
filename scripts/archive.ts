#!/usr/bin/env bun
// Packages every built target into a release asset:
//   loophole-<target>.zip     (windows, darwin)
//   loophole-<target>.tar.gz  (linux, including musl)
// Each archive contains the bare binary at its root so `brew install`, WinGet,
// and manual downloads all resolve to `loophole` / `loophole.exe` directly.
import { existsSync } from "node:fs"
import path from "node:path"
import { $ } from "bun"

const builder = path.resolve(import.meta.dir, "..")
const app = process.env.APP_DIR ?? path.resolve(builder, "../loophole-app")
const dist = process.env.CLI_DIST ?? path.join(app, "packages", "cli", "dist")
const out = process.env.ASSETS_DIR ?? path.join(builder, "assets")
const version = process.env.LOOPHOLE_VERSION ?? ""

if (!existsSync(dist)) throw new Error(`CLI dist not found: ${dist}`)

await $`rm -rf ${out}`.quiet()
await $`mkdir -p ${out}`.quiet()

const platformPackages = await Array.fromAsync(new Bun.Glob("cli-*/package.json").scan({ cwd: dist }))
const assets: string[] = []
for (const relative of platformPackages.toSorted()) {
  const dir = path.dirname(path.join(dist, relative))
  const pkg = await Bun.file(path.join(dir, "package.json")).json()
  if (typeof pkg.name !== "string" || !pkg.name.startsWith("@loophole-ai/cli-"))
    throw new Error(`Unexpected package: ${pkg.name}`)
  const target = pkg.name.slice("@loophole-ai/cli-".length)
  if (version && pkg.version !== version) throw new Error(`${pkg.name} is ${pkg.version}, expected ${version}`)
  const windows = target.startsWith("windows")
  const binary = path.join(dir, "bin", windows ? "loophole.exe" : "loophole")
  if (!(await Bun.file(binary).exists())) throw new Error(`Missing binary: ${binary}`)

  const file = path.join(out, `loophole-${target}${windows || target.startsWith("darwin") ? ".zip" : ".tar.gz"}`)
  if (file.endsWith(".zip")) await $`zip -q -j ${file} ${binary}`
  else await $`tar -czf ${file} -C ${path.dirname(binary)} loophole`
  assets.push(file)
  console.log(`packaged ${path.basename(file)}`)
}

await Bun.write(path.join(out, "install.sh"), Bun.file(path.join(builder, "install.sh")))

const checksums = await Promise.all(
  assets.map(async (file) => {
    const hash = new Bun.CryptoHasher("sha256")
    hash.update(await Bun.file(file).arrayBuffer())
    return `${hash.digest("hex")}  ${path.basename(file)}`
  }),
)
await Bun.write(path.join(out, "SHA256SUMS"), `${checksums.join("\n")}\n`)

console.log(`wrote ${assets.length} archives + install.sh + SHA256SUMS to ${out}`)
