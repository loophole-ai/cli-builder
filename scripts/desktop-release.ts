#!/usr/bin/env bun
// Creates/updates the desktop release in loophole-app with every installer and
// electron-updater manifest. The manifests must live on the *latest* release
// because the app's updater reads releases/latest/download/latest*.yml.
import path from "node:path"
import { $ } from "bun"

const builder = path.resolve(import.meta.dir, "..")
const version = process.env.LOOPHOLE_VERSION ?? ""
const tag = process.env.TAG ?? `v${version}`
const repo = process.env.RELEASE_REPO ?? "loophole-ai/loophole-app"
const ref = process.env.APP_REF ?? "loophole"
const dist = process.env.DESKTOP_DIST ?? path.join(builder, "desktop-assets")

if (!version) throw new Error("LOOPHOLE_VERSION is required")
if (!process.env.GH_TOKEN && !process.env.RELEASE_TOKEN) throw new Error("RELEASE_TOKEN (or GH_TOKEN) is required")
process.env.GH_TOKEN = process.env.GH_TOKEN ?? process.env.RELEASE_TOKEN

const pattern = /\.(dmg|zip|exe|blockmap|AppImage|deb|rpm)$|^latest.*\.yml$/i
const assets = await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dist }))
  .then((files) => files.filter((file) => pattern.test(path.basename(file))).map((file) => path.join(dist, file)))
  .then((files) => [...new Set(files)])

if (!assets.length) throw new Error(`No desktop release files found in ${dist}`)
if (process.argv.includes("--dry-run")) {
  for (const file of assets) console.log(path.relative(dist, file))
  process.exit(0)
}

const notes = path.join(dist, "RELEASE_NOTES.md")
await Bun.write(
  notes,
  `## Loophole Desktop ${tag}

The Loophole desktop app, bundling Loophole CLI ${process.env.CLI_VERSION ?? version}.

### Downloads

${assets
  .map((file) => path.basename(file))
  .filter((file) => /\.(dmg|exe|AppImage|deb|rpm)$/i.test(file))
  .map((file) => `- \`${file}\``)
  .join("\n")}

### Notes

- Unsigned build: macOS asks you to right-click the app and choose **Open**; Windows shows a SmartScreen prompt.
- Auto-updates use the \`latest*.yml\` manifests attached below.
`,
)

const paths = [...assets, notes]
const view = await $`gh release view ${tag} --repo ${repo}`.quiet().nothrow()

if (view.exitCode === 0) {
  console.log(`updating existing release ${tag}`)
  const upload = await $`gh release upload ${tag} ${paths} --clobber --repo ${repo}`.nothrow()
  if (upload.exitCode !== 0) throw new Error(`Failed to upload desktop assets\n${upload.stderr.toString()}`)
} else {
  console.log(`creating release ${tag} on ${repo}@${ref}`)
  const create =
    await $`gh release create ${tag} ${paths} --repo ${repo} --target ${ref} --title ${`Loophole Desktop ${tag}`} --notes-file ${notes}`.nothrow()
  if (create.exitCode !== 0) throw new Error(`Failed to create release\n${create.stderr.toString()}`)
}

console.log(`release ready: https://github.com/${repo}/releases/tag/${tag}`)
