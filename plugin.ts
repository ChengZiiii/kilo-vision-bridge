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

// Degraded-mode fallback used when the sibling subagent-body.md is missing
// (e.g. only dist/index.js was copied into the plugin auto-load dir). Without
// this, module load throws and Kilo silently skips the whole plugin.
const bodyTpl: string = (() => {
  try {
    return readFileSync(join(dataDir, "subagent-body.md"), "utf8")
  } catch {
    return "You are a vision subagent. Read each image file listed in the prompt, analyze only those images against the visual task, and respond with exactly one JSON object matching the response template. Do not emit prose or extra keys. Use null for anything that cannot be determined from the images."
  }
})()

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
// RV-1/RV-2: folded (toLowerCase) "provider/model" keys of registered vision
// models; agent-name -> vision-capable map; top-level default capability.
// Populated in the config hook and read by the messages/system transforms.
let visionModelKeys = new Set<string>()
let agentVisionCapable = new Map<string, boolean>()
let defaultVisionCapable = false
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
    const folded = raw.toLowerCase()
    // Fold the persisted line against registeredModels keys so mixed-case
    // ids still resolve; return the canonical registered key.
    for (const key of registeredModels.keys()) {
      if (key.toLowerCase() === folded) {
        const model = registeredModels.get(key)
        if (model?.supportsImage) return key
      }
    }
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
  const folded = providerID.toLowerCase()
  for (const section of [config.provider, config.providers]) {
    if (!section) continue
    for (const key of Object.keys(section)) {
      if (key.toLowerCase() === folded) return section[key] ?? {}
    }
  }
  return {}
}

// Canonicalize a provider id against the catalog: return the first catalog
// provider key whose lowercase form matches (catalog casing wins), falling
// back to the input id when the provider is absent from the catalog (e.g.
// config-only providers like `78code-codex`).
function canonicalProviderID(catalog: ModelsCatalog, id: string): string {
  const folded = id.toLowerCase()
  const existing = Object.keys(catalog).find((key) => key.toLowerCase() === folded)
  return existing ?? id
}

function configuredProviderIDs(config: ConfigLike, catalog: ModelsCatalog): string[] {
  const disabled = new Set(
    stringArray(config.disabled_providers).map((id) => id.toLowerCase())
  )
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
  return Array.from(
    new Set(ids.map((id) => canonicalProviderID(catalog, id)))
  ).filter((id) => !disabled.has(id.toLowerCase()))
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

// Case-insensitive id matching (RB-4): the cached catalog (~/.cache/kilo/
// models.json) and Kilo configs may use different casings for the same
// provider/model id (e.g. catalog stores `MiniMax-M3` while the config writes
// `minimax-m3`). All lookups fold ids to lowercase; outputs (registeredModels
// keys, subagent names) keep the catalog's canonical casing.

function foldKey(record: Record<string, unknown>, key: string): string {
  const folded = key.toLowerCase()
  const existing = Object.keys(record).find((k) => k.toLowerCase() === folded)
  return existing ?? key
}

function providerModels(
  providerID: string,
  catalog: ModelsCatalog,
  config: ConfigLike,
): Record<string, RawModel> {
  const configured = providerConfig(config, providerID)
  const catalogProvider =
    catalog[providerID] ?? catalog[String(providerID).toLowerCase()] ?? {}
  const models: Record<string, RawModel> = {
    ...(catalogProvider.models ?? {}),
  }

  for (const [key, override] of Object.entries(configured.models ?? {})) {
    const id = override.id ?? key
    const targetKey = foldKey(models, id)
    models[targetKey] = mergeModel(models[targetKey], override)
  }

  return models
}

function modelAllowed(providerConfig: ProviderConfig, modelID: string): boolean {
  const folded = modelID.toLowerCase()
  const blacklist = stringArray(providerConfig.blacklist).map((id) => id.toLowerCase())
  const whitelist = stringArray(providerConfig.whitelist).map((id) => id.toLowerCase())
  if (blacklist.includes(folded)) return false
  if (whitelist.length > 0 && !whitelist.includes(folded)) return false
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
  const match = models[foldKey(models, parts.modelID)]
  return Boolean(match && isVisionModel(match))
}

// RV-1: resolve whether a user message's handling model is vision-capable.
// Order: (1) message info.model (providerID/modelID) folded vs visionModelKeys;
// (2) message info.agent vs agentVisionCapable; (3) defaultVisionCapable.
// UserMessage.model.modelID is the inline message type's field (NOT the Model
// type, which uses `id`).
function userMessageVisionCapable(info: {
  role: string
  agent?: string
  model?: { providerID?: string; modelID?: string }
}): boolean {
  const m = info.model
  if (
    m &&
    typeof m.providerID === "string" &&
    typeof m.modelID === "string" &&
    (m.providerID !== "" || m.modelID !== "")
  ) {
    return visionModelKeys.has(`${m.providerID}/${m.modelID}`.toLowerCase())
  }
  if (typeof info.agent === "string" && agentVisionCapable.has(info.agent)) {
    return Boolean(agentVisionCapable.get(info.agent))
  }
  return defaultVisionCapable
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

  // RV-1/RV-2/RV-3: build per-agent capability state from the registered
  // vision model set and each configured agent's model. Built BEFORE the
  // subagent-registration loop so it captures user-configured agents; the
  // vision-* subagents registered below are harmless either way since their
  // own messages carry a vision info.model that wins first in the transform.
  visionModelKeys = new Set(
    [...registeredModels.keys()].map((k) => k.toLowerCase()),
  )
  defaultVisionCapable = configuredModelVisionCapable(cfg.model, catalog, cfg as ConfigLike)
  agentVisionCapable = new Map()
  const agentsSection = (cfg as ConfigLike & {
    agent?: Record<string, { model?: string } | undefined>
  }).agent ?? {}
  for (const [name, entry] of Object.entries(agentsSection)) {
    if (entry && typeof entry.model === "string") {
      agentVisionCapable.set(
        name,
        configuredModelVisionCapable(entry.model, catalog, cfg as ConfigLike),
      )
    }
  }

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

  // RV-3: vision-* subagents are ALWAYS registered. The previous global skip
  // (early-return when the top-level model was vision-capable) is removed — a
  // multimodal main model coexisting with a text-only agent needs the
  // subagents. Non-delegation for a multimodal model is enforced by the
  // messages/system transforms and the skill's "When NOT to invoke" self-gate,
  // not by withholding registration.
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
      // RV-1: a vision-capable user message keeps image parts untouched
      // (native path). The rewrite loop below then runs only for text-only
      // messages.
      if (userMessageVisionCapable(m.info)) continue
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
  "experimental.chat.system.transform": async (input, output) => {
    // RV-2: input.model is Model (has providerID + id, NOT modelID).
    // Reuse the folded visionModelKeys lookup (RB-4 MODIFIED).
    const model = input.model
    const capable = Boolean(
      model &&
        typeof model.providerID === "string" &&
        typeof model.id === "string" &&
        visionModelKeys.has(`${model.providerID}/${model.id}`.toLowerCase()),
    )
    if (capable) {
      output.system.push(
        "[vision:native] You receive image parts natively in this session. " +
          "Inspect images directly from the message. Do NOT use the vision skill, " +
          "do NOT delegate visual tasks to a vision-* subagent, and ignore any " +
          "[vision:model-script] / [vision:model-choice] instructions.",
      )
      return
    }
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
