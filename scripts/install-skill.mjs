#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"

// Resolve the bundled SKILL.md relative to this script. When run from the
// installed npm package, the file layout is:
//   <pkg>/scripts/install-skill.mjs   (this file)
//   <pkg>/SKILL.md                    (the skill source)
const here = dirname(fileURLToPath(import.meta.url))
const pkgRoot = dirname(here)
const src = join(pkgRoot, "SKILL.md")

if (!existsSync(src)) {
  // Nothing to install — this can happen during partial dev installs.
  // Exit quietly so `npm install` doesn't fail.
  process.exit(0)
}

// Destination: ~/.config/kilo/skills/vision/SKILL.md
// Respect KILO_CONFIG_DIR and XDG_CONFIG_HOME like kilo does.
const configDir =
  process.env.KILO_CONFIG_DIR ||
  (process.env.XDG_CONFIG_HOME
    ? join(process.env.XDG_CONFIG_HOME, "kilo")
    : join(homedir(), ".config", "kilo"))
const destDir = join(configDir, "skills", "vision")
const dest = join(destDir, "SKILL.md")

mkdirSync(destDir, { recursive: true })
cpSync(src, dest)
console.log(`kilo-vision-bridge: installed skill to ${dest}`)
