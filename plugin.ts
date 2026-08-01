import type { Plugin } from "@kilocode/plugin"
import { readFileSync, existsSync, writeFileSync, copyFileSync, mkdirSync, cpSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve } from "node:path"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"

// Resolve sibling data files relative to the bundle. When run from source,
// `import.meta.url` is plugin.ts and the files sit next to it. When run from
// the built dist/index.js, the files ship in the package root (one level up
// from dist/) per `files` in package.json.
const bundleDir = dirname(fileURLToPath(import.meta.url))
const candidateDirs = [bundleDir, join(bundleDir, "..")]
const dataDir =
  candidateDirs.find(
    (d) =>
      existsSync(join(d, "subagent-body.md")) &&
      existsSync(join(d, "scripts", "vision-models.mjs"))
  ) ?? bundleDir

const bodyTpl = readFileSync(join(dataDir, "subagent-body.md"), "utf8")

type VisionModelEntry = {
  provider: string
  model_id: string
  name: string
  supportsImage: boolean
}

type RawModel = {
  id?: string
  name?: string
  attachment?: boolean
  reasoning?: boolean
  tool_call?: boolean
  status?: string
  release_date?: string
  modalities?: {
    input?: string[]
    output?: string[]
  }
  limit?: {
    context?: number
  }
}

type RawProvider = {
  env?: string[]
  models?: Record<string, RawModel>
}

type ProviderConfig = {
  whitelist?: string[]
  blacklist?: string[]
  models?: Record<string, RawModel>
}

type ConfigLike = {
  model?: string
  disabled_providers?: string[]
  enabled_providers?: string[]
  provider?: Record<string, ProviderConfig>
  providers?: Record<string, ProviderConfig>
}

type ModelsCatalog = Record<string, RawProvider>

const VISION_MODELS_SCRIPT = join(dataDir, "scripts", "vision-models.mjs")
let registeredModels = new Map<string, VisionModelEntry>()
const IMAGE_TMP_DIR = join(tmpdir(), "kilo-vision-bridge")

const PERMISSION = {
  edit: "deny",
  read: "allow",
  glob: "allow",
  grep: "allow",
  list: "allow",
  external_directory: {
    [join(IMAGE_TMP_DIR, "*")]: "allow",
  },
}

function subagentName(entry: Pick<VisionModelEntry, "provider" | "model_id">): string {
  return (
    "vision-" +
    entry.provider +
    "-" +
    entry.model_id.replace(/[/:]/g, "-")
  )
}

function homeDir(): string {
  return process.env.KILO_TEST_HOME ?? homedir()
}

function xdgPath(kind: string, fallback: string): string {
  return process.env[kind] ?? join(homeDir(), fallback)
}

function kiloConfigDir(): string {
  return resolve(
    process.env.KILO_CONFIG_DIR ??
      join(xdgPath("XDG_CONFIG_HOME", ".config"), "kilo")
  )
}

function kiloCacheDir(): string {
  return resolve(join(xdgPath("XDG_CACHE_HOME", ".cache"), "kilo"))
}

function kiloDataDir(): string {
  return resolve(
    process.env.KILO_DATA_DIR ??
      join(xdgPath("XDG_DATA_HOME", ".local/share"), "kilo")
  )
}

function kiloModelsFile(): string {
  if (process.env.KILO_MODELS_PATH) return resolve(process.env.KILO_MODELS_PATH)
  const source = process.env.KILO_MODELS_URL ?? "https://models.dev"
  const file =
    source === "https://models.dev"
      ? "models.json"
      : `models-${createHash("sha1").update(source).digest("hex")}.json`
  return join(kiloCacheDir(), file)
}

function visionChoiceFile(): string {
  return join(kiloConfigDir(), "vision-model-image.txt")
}

function readPersistedChoice(): string | undefined {
  try {
    const file = visionChoiceFile()
    if (!existsSync(file)) return
    const raw = readFileSync(file, "utf8").trim()
    const model = registeredModels.get(raw)
    if (model?.supportsImage) return raw
  } catch {
    return
  }
}

function readModelsCatalog(): ModelsCatalog {
  try {
    const file = kiloModelsFile()
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, "utf8")) as ModelsCatalog
  } catch {
    return {}
  }
}

function readAuthData(): Record<string, unknown> {
  try {
    if (process.env.KILO_AUTH_CONTENT) {
      return JSON.parse(process.env.KILO_AUTH_CONTENT) as Record<string, unknown>
    }
    const file = join(kiloDataDir(), "auth.json")
    if (!existsSync(file)) return {}
    return JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
  } catch {
    return {}
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

function mergeModel(existing: RawModel | undefined, override: RawModel): RawModel {
  if (!existing) return override
  return {
    ...existing,
    ...override,
    modalities: {
      ...existing.modalities,
      ...override.modalities,
    },
    limit: {
      ...existing.limit,
      ...override.limit,
    },
  }
}

function providerConfig(config: ConfigLike, providerID: string): ProviderConfig {
  return config.provider?.[providerID] ?? config.providers?.[providerID] ?? {}
}

function configuredProviderIDs(config: ConfigLike, catalog: ModelsCatalog): string[] {
  const disabled = new Set(stringArray(config.disabled_providers))
  const enabled = stringArray(config.enabled_providers)
  const explicit = Object.keys({
    ...(config.providers ?? {}),
    ...(config.provider ?? {}),
  })
  const envConfigured = Object.entries(catalog)
    .filter(([, provider]) => stringArray(provider.env).some((key) => Boolean(process.env[key])))
    .map(([id]) => id)
  const authConfigured = Object.entries(readAuthData())
    .filter(([, value]) => value !== null && typeof value === "object" && typeof (value as any).type === "string")
    .map(([id]) => id.replace(/\/+$/, ""))
  const ids =
    enabled.length > 0
      ? enabled
      : [...explicit, ...envConfigured, ...authConfigured]
  return Array.from(new Set(ids)).filter((id) => !disabled.has(id))
}

function modelInputModalities(model: RawModel): string[] {
  return stringArray(model.modalities?.input)
}

function isVisionModel(model: RawModel): boolean {
  const input = modelInputModalities(model)
  if (input.includes("image")) return true
  return input.length === 0 && model.attachment === true
}

function modelCapabilities(model: RawModel): { supportsImage: boolean } {
  const input = modelInputModalities(model)
  const supportsImage = input.includes("image") || (input.length === 0 && model.attachment === true)
  return { supportsImage }
}

function providerModels(
  providerID: string,
  catalog: ModelsCatalog,
  config: ConfigLike,
): Record<string, RawModel> {
  const configured = providerConfig(config, providerID)
  const models: Record<string, RawModel> = {
    ...(catalog[providerID]?.models ?? {}),
  }

  for (const [key, override] of Object.entries(configured.models ?? {})) {
    const id = override.id ?? key
    models[key] = mergeModel(models[id] ?? models[key], override)
  }

  return models
}

function modelAllowed(providerConfig: ProviderConfig, modelID: string): boolean {
  const blacklist = stringArray(providerConfig.blacklist)
  const whitelist = stringArray(providerConfig.whitelist)
  if (blacklist.includes(modelID)) return false
  if (whitelist.length > 0 && !whitelist.includes(modelID)) return false
  return true
}

function discoverVisionModels(catalog: ModelsCatalog, config: ConfigLike): VisionModelEntry[] {
  const result: VisionModelEntry[] = []
  for (const provider of configuredProviderIDs(config, catalog)) {
    const configured = providerConfig(config, provider)
    for (const [modelKey, model] of Object.entries(providerModels(provider, catalog, config))) {
      const modelID = modelKey
      if (!modelAllowed(configured, modelKey)) continue
      if (model.status === "deprecated") continue
      if (!isVisionModel(model)) continue
      result.push({
        provider,
        model_id: modelID,
        name: model.name ?? modelID,
        ...modelCapabilities(model),
      })
    }
  }
  result.sort((a, b) => `${a.provider}/${a.model_id}`.localeCompare(`${b.provider}/${b.model_id}`))
  return result
}

function splitModel(value: string): { provider: string; modelID: string } | undefined {
  const slash = value.indexOf("/")
  if (slash <= 0 || slash === value.length - 1) return
  return {
    provider: value.slice(0, slash),
    modelID: value.slice(slash + 1),
  }
}

function configuredModelVisionCapable(
  model: string | undefined,
  catalog: ModelsCatalog,
  config: ConfigLike,
): boolean {
  if (!model) return false
  const parts = splitModel(model)
  if (!parts) return false
  const models = providerModels(parts.provider, catalog, config)
  const match = models[parts.modelID]
  return Boolean(match && isVisionModel(match))
}

function saveImagePart(
  url: string,
  sessionID: string,
  partID: string,
  ext: string,
): string {
  mkdirSync(IMAGE_TMP_DIR, { recursive: true })
  const stableID = createHash("sha256")
    .update(sessionID)
    .update("\0")
    .update(partID)
    .digest("hex")
    .slice(0, 24)
  const out = join(IMAGE_TMP_DIR, `vision-${stableID}.${ext}`)

  if (url.startsWith("data:")) {
    const comma = url.indexOf(",")
    if (comma < 0) throw new Error("Malformed image data URL")
    const payload = url.slice(comma + 1)
    if (!payload) throw new Error("Empty image data URL")
    writeFileSync(out, Buffer.from(payload, "base64"))
    return out
  }

  const src = url.startsWith("file://") ? fileURLToPath(url) : url
  copyFileSync(src, out)
  return out
}

function isImageMime(mime: string): boolean {
  if (mime.startsWith("image/")) return true
  return false
}

function mimeToExt(mime: string): string {
  if (mime.includes("png")) return "png"
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg"
  if (mime.includes("webp")) return "webp"
  if (mime.includes("gif")) return "gif"
  return "png"
}

// Sync SKILL.md into the default-scanned skills directory at module import
// time. OpenCode's plugin installer suppresses npm postinstall
// (ignoreScripts:true), so a postinstall hook cannot be relied on. Doing the
// sync here — at module load, which runs before skill discovery on the same
// launch — ensures the skill is discoverable on the FIRST launch after
// install, not just the second.
//
// Sync logic (handles upgrades, stale files, and previous-version installs):
//   1. Read the source SKILL.md bytes from the installed package.
//   2. If the destination already exists and its bytes are identical, the
//      skill is already in sync — skip the write (avoids unnecessary disk
//      I/O and filesystem-watcher churn on every launch).
//   3. If the destination is missing or its content differs (e.g. the
//      plugin was upgraded and SKILL.md changed, or a previous version's
//      file is stale), overwrite it with the current source.
function ensureSkillInstalled() {
  const src = join(dataDir, "SKILL.md")
  if (!existsSync(src)) return
  const destDir = join(kiloConfigDir(), "skills", "vision")
  const dest = join(destDir, "SKILL.md")
  try {
    const srcBytes = readFileSync(src)
    if (existsSync(dest) && srcBytes.equals(readFileSync(dest))) return
    mkdirSync(destDir, { recursive: true })
    cpSync(src, dest)
  } catch {
    // Non-fatal: the config hook's skills.paths push is a fallback.
  }
}
ensureSkillInstalled()

const plugin: Plugin = async () => ({
  config: async (cfg) => {
    const catalog = readModelsCatalog()
    const dynamicModels = discoverVisionModels(catalog, cfg as ConfigLike)
    registeredModels = new Map(
      dynamicModels.map((m) => [`${m.provider}/${m.model_id}`, m])
    )

  // Register the skill in-place: push the package data dir (which contains
  // SKILL.md) onto config.skills.paths. OpenCode scans **/SKILL.md under each
  // path, so this makes the vision skill discoverable straight out of the
  // installed npm package — no postinstall copy, no symlink. OpenCode's plugin
  // installer runs npm with ignoreScripts:true, so a postinstall hook cannot
  // be relied on (see kilo-vision-bridge README "Troubleshooting").
  const cfgAny = cfg as ConfigLike & {
    skills?: { paths?: string[] }
  }
  cfgAny.skills ??= {}
  cfgAny.skills.paths ??= []
  if (!cfgAny.skills.paths.includes(dataDir)) {
    cfgAny.skills.paths.push(dataDir)
  }

  // Startup gate (B): if the configured default orchestrator model is
  // itself vision-capable, skip registering the vision-* subagents — they
  // would be redundant. The skill still loads via the skills.paths entry
  // pushed above and self-gates in its body ("When NOT to invoke").
  if (configuredModelVisionCapable(cfg.model, catalog, cfg as ConfigLike)) {
    registeredModels = new Map()
    return
  }

    cfg.agent ??= {}
    for (const e of dynamicModels) {
      const name = subagentName(e)
      cfg.agent[name] ??= {}
      Object.assign(cfg.agent[name], {
        description: `Visual judgment subagent (${e.name}). Consumes a prompt-authored visual task with image paths and a task-specific JSON response template. Not coupled to any screenshot tool or UI framework - works with locally stored images supported by the model.`,
        mode: "subagent",
        model: `${e.provider}/${e.model_id}`,
        temperature: 0.1,
        prompt: bodyTpl
          .replaceAll("{{model_name}}", e.name)
          .replaceAll("{{provider}}", e.provider)
          .replaceAll("{{model_id}}", e.model_id),
        permission: PERMISSION,
      })
    }
  },

  // Source D: materialize user-dropped images as stable paths that the
  // orchestrator can pass to a vision subagent through the task tool.
  "experimental.chat.messages.transform": async (_input, output) => {
    for (const m of output.messages) {
      if (m.info.role !== "user") continue
      for (const part of m.parts) {
        if (part.type !== "file") continue
        if (!part.mime) continue
        if (!isImageMime(part.mime)) continue
        const originalFilename = part.filename ?? "image"
        let text: string
        try {
          const path = saveImagePart(
            part.url,
            m.info.sessionID,
            part.id,
            mimeToExt(part.mime),
          )
          text = `[vision:dropped-image] ${JSON.stringify({
            mime: part.mime,
            path,
            originalFilename,
          })}`
        } catch (error) {
          text = `[vision:dropped-image-error] ${JSON.stringify({
            mime: part.mime,
            originalFilename,
            error: error instanceof Error ? error.message : String(error),
          })}`
        }
        ;(part as any).type = "text"
        ;(part as any).text = text
        ;(part as any).synthetic = true
      }
    }
  },

  // Persisted model choice is still read by the plugin so the orchestrator
  // can avoid re-asking. Model listing and persistence changes are handled
  // by scripts/vision-models.mjs, not a plugin-injected tool.
  "experimental.chat.system.transform": async (_input, output) => {
    output.system.push(
      `[vision:model-script] Query available image-capable vision models with: node ${VISION_MODELS_SCRIPT}. ` +
        `Persist a choice with: node ${VISION_MODELS_SCRIPT} --model <provider/model>. ` +
        `Do not use a hardcoded model picker list.`,
    )
    const choice = readPersistedChoice()
    if (choice) {
      output.system.push(
        `[vision:model-choice] model=${choice}. ` +
          `Reuse this model for image visual delegations without asking. ` +
          `To use a different model, run the vision model script with --model <provider/model>.`,
      )
    }
  },
})

export default { id: "vision", server: plugin }
