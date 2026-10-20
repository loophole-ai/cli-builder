#!/usr/bin/env bun
// Creates (or updates) the GitHub release in loophole-ai/loophole-app with the
// packaged CLI assets. Requires a token with contents:write on that repo, passed
// as RELEASE_TOKEN / GH_TOKEN.
import path from "node:path"
import { $ } from "bun"

const builder = path.resolve(import.meta.dir, "..")
const version = process.env.LOOPHOLE_VERSION ?? ""
const tag = process.env.TAG ?? `v${version}`
const repo = process.env.RELEASE_REPO ?? "loophole-ai/loophole-app"
const ref = process.env.APP_REF ?? "loophole"
const assets = process.env.ASSETS_DIR ?? path.join(builder, "assets")

if (!version) throw new Error("LOOPHOLE_VERSION is required")
if (!process.env.GH_TOKEN && !process.env.RELEASE_TOKEN) throw new Error("RELEASE_TOKEN (or GH_TOKEN) is required")
process.env.GH_TOKEN = process.env.GH_TOKEN ?? process.env.RELEASE_TOKEN

const files = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: assets }))
if (!files.length) throw new Error(`No assets found in ${assets}`)

const notes = path.join(assets, "RELEASE_NOTES.md")
await Bun.write(
  notes,
  `## Loophole CLI ${tag}

Open-source AI coding agent for the terminal.

### Install

\`\`\`bash
npm i -g @loophole-ai/cli@${version}
# or
bun add -g @loophole-ai/cli@${version}
# or
curl -fsSL https://github.com/${repo}/releases/download/${tag}/install.sh | bash
\`\`\`

### Platforms

${files
  .filter((file) => file !== "RELEASE_NOTES.md" && file !== "install.sh" && file !== "SHA256SUMS")
  .map((file) => `- \`${file}\``)
  .join("\n")}

Checksums: \`SHA256SUMS\`.
`,
)

const paths = files.map((file) => path.join(assets, file))
const view = await $`gh release view ${tag} --repo ${repo}`.quiet().nothrow()

if (view.exitCode === 0) {
  console.log(`updating existing release ${tag}`)
  const upload = await $`gh release upload ${tag} ${paths} --clobber --repo ${repo}`.nothrow()
  if (upload.exitCode !== 0) throw new Error(`Failed to upload assets\n${upload.stderr.toString()}`)
} else {
  console.log(`creating release ${tag} on ${repo}@${ref}`)
  const create = await $`gh release create ${tag} ${paths} --repo ${repo} --target ${ref} --title ${`Loophole CLI ${tag}`} --notes-file ${notes}`.nothrow()
  if (create.exitCode !== 0) throw new Error(`Failed to create release\n${create.stderr.toString()}`)
}

console.log(`release ready: https://github.com/${repo}/releases/tag/${tag}`)
