#!/usr/bin/env bun
// Posts the release announcement to the Discord server through a channel
// webhook (DISCORD_WEBHOOK secret). Once-per-release: after posting, the
// marker is appended to the release body, so re-running the builder (e.g. to
// refresh Homebrew) never double-posts.
import { $ } from "bun"

const version = process.env.LOOPHOLE_VERSION ?? ""
const tag = process.env.TAG ?? `v${version}`
const repo = process.env.RELEASE_REPO ?? ""
const kind = process.env.RELEASE_KIND ?? "CLI"
const webhook = process.env.DISCORD_WEBHOOK ?? ""
const marker = "<!-- discord-announced -->"
const force = process.env.ANNOUNCE_FORCE === "1" || process.argv.includes("--force")

if (!version) throw new Error("LOOPHOLE_VERSION is required")
if (!repo) throw new Error("RELEASE_REPO is required")
if (!process.env.GH_TOKEN && !process.env.RELEASE_TOKEN) throw new Error("RELEASE_TOKEN (or GH_TOKEN) is required")
process.env.GH_TOKEN = process.env.GH_TOKEN ?? process.env.RELEASE_TOKEN
if (!webhook) {
  console.log("DISCORD_WEBHOOK not set; skipping announcement")
  process.exit(0)
}

const view = await $`gh release view ${tag} --repo ${repo} --json body`.quiet().nothrow()
if (view.exitCode !== 0) throw new Error(`Failed to read release ${tag}\n${view.stderr.toString()}`)
const body = JSON.parse(view.stdout.toString()).body as string
if (body.includes(marker) && !force) {
  console.log(`${tag} already announced; skipping (set ANNOUNCE_FORCE=1 to re-post)`)
  process.exit(0)
}

const url = `https://github.com/${repo}/releases/tag/${tag}`
const name = kind === "Desktop" ? "Loophole Desktop" : "Loophole CLI"
const description =
  kind === "Desktop"
    ? `Installers for Windows, macOS and Linux, bundling Loophole CLI ${process.env.CLI_VERSION ?? version}. Auto-update picks this up for existing installs.`
    : `Install: \`npm i -g @loophole-ai/cli@${version}\``

const res = await fetch(webhook, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    username: "Loophole Releases",
    embeds: [
      {
        title: `${name} ${tag} is out`,
        url,
        description,
        color: 0xfefefe,
        footer: { text: `Released ${new Date().toISOString().slice(0, 10)} · ${repo}` },
      },
    ],
  }),
})
if (!res.ok) throw new Error(`Discord webhook failed: ${res.status} ${await res.text()}`)

const edit = await $`gh release edit ${tag} --repo ${repo} --notes ${`${body}\n\n${marker}`}`.nothrow()
if (edit.exitCode !== 0 && !body.includes(marker))
  throw new Error(`Failed to mark ${tag} as announced\n${edit.stderr.toString()}`)
console.log(`announced ${tag} to Discord`)
