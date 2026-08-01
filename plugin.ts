import type { Plugin } from "@kilocode/plugin"
import { tool } from "@kilocode/plugin"
import { readFileSync, existsSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join, resolve, isAbsolute } from "node:path"
import { homedir, tmpdir } from "node:os"
import { createHash } from "node:crypto"
import {
  buildVisionRequest,
  parseVisionResponse,
  resolveVisionEndpoint,
  resolveVisionApiKey,
  postVisionRequest,
} from "./src/vision-http.ts"

// Resolve the data dir (the skills.paths entry pointing at SKILL.md) relative
// to the bundle. When run from source, `import.meta.url` is plugin.ts and
// SKILL.md sits next to it. When run from the built dist/index.js, the npm
// package root (one level up from dist/) has SKILL.md. Plugin-directory
// installs (a lone dist/index.js copied into ~/.config/kilo/plugin/) have no
// SKILL.md sibling, so the lookup falls back to bundleDir harmlessly: the
// skills.paths scan finds no SKILL.md and Method B installs copy SKILL.md
// manually per the README.
const bundleDir = dirname(fileURLToPath(import.meta.url))
const candidateDirs = [bundleDir, join(bundleDir, "..")]
const dataDir =
  candidateDirs.find((d) => existsSync(join(d, "SKILL.md"))) ?? bundleDir

// Inlined vision-agent prompt (previously subagent-body.md). Placeholder-free.
const bodyTpl: string = `You are a vision subagent. Your model is configured by the user through the Kilo Code agent model override. Read each image file listed in the prompt, analyze only those images against the visual task, and respond with exactly one JSON object matching the response template.

## Input

The prompt contains a Visual Task (the exact visual question), Images to Inspect (local image paths and why each matters), a Response Template (the exact JSON shape to return), and Response Rules (task-specific constraints).

## Rules

- Report what you actually observe; do not guess. Be specific: positions, colors, sizes, alignment, visibility, ordering, etc.
- Include visual evidence wherever the template provides an evidence field; use \`null\` for facts that cannot be determined when the template permits null.
- If an image cannot be analyzed (corrupted, wrong format, file not found, or unsupported image modality), fill the template's uncertainty/failure fields honestly, preserving the exact template shape.
- Choose one concrete value for enum-like placeholders such as \`"pass | fail | inconclusive"\`.
- Emit exactly one JSON object: no prose, markdown fences, commentary, or extra keys.
- Do not spawn subagents. You are a leaf in the execution tree.`

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
  options?: { baseURL?: string }
}

type ConfigLike = {
  model?: string
  disabled_providers?: string[]
  enabled_providers?: string[]
  provider?: Record<string, ProviderConfig>
  providers?: Record<string, ProviderConfig>
}

type ModelsCatalog = Record<string, RawProvider>

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

// vision_analyze tool state (VT-2 / RV-6): the tool's model source is the
// user's agent["vision-agent"].model override captured at config time. The
// plugin never writes `model` or `disable`; `disable: true` on vision-agent
// removes the tool from the registry.
const VISION_TOOL_NAME = "vision_analyze"
const VISION_TOOL_TIMEOUT_MS = 60_000
let visionToolModel: string | undefined
let visionToolDisabled = false
let visionToolConfig: ConfigLike = {}
let visionToolCatalog: ModelsCatalog = {}

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

// VT-1/VT-2/VT-5: the native vision_analyze tool. execute runs in-process:
// model configured (from agent["vision-agent"].model) -> endpoint + key
// resolution -> read images -> OpenAI-compatible or Anthropic-shaped chat
// completion (shape resolved from the endpoint URL, see src/vision-http.ts)
// -> return the model's raw JSON text. Error categories are encoded in the
// message prefix so the skill can branch: "model not configured" (never
// falls back), "provider error" (falls back to the vision-agent subagent),
// "invalid response" (skill Step 6 retry).
function visionAnalyzeTool() {
  return tool({
    description:
      "Performs a visual judgment on local image files with the configured vision model. " +
      "Pass `images` as [{id, path}] (short contract ids plus local image paths), the exact visual " +
      "`question`, a `response_template` (JSON string defining the required response shape), and " +
      "optional `response_rules` for task-specific constraints. Returns exactly one JSON object " +
      "matching the response template.",
    args: {
      images: tool.schema.array(
        tool.schema.object({
          id: tool.schema.string(),
          path: tool.schema.string(),
        }),
      ),
      question: tool.schema.string(),
      response_template: tool.schema.string(),
      response_rules: tool.schema.optional(tool.schema.string()),
    },
    async execute(args, ctx) {
      if (visionToolDisabled) {
        throw new Error(
          'vision_analyze: vision-agent is disabled: set disable: false on agent["vision-agent"] to use this tool',
        )
      }
      if (!visionToolModel) {
        throw new Error(
          'vision_analyze: model not configured: set agent["vision-agent"].model to a vision-capable ' +
            'provider/model (e.g. "minimax-cn-coding-plan/MiniMax-M3")',
        )
      }
      const parts = splitModel(visionToolModel)
      if (!parts) {
        throw new Error(
          `vision_analyze: model not configured: invalid model id "${visionToolModel}" (expected "provider/model")`,
        )
      }
      const models = providerModels(parts.provider, visionToolCatalog, visionToolConfig)
      const match = models[foldKey(models, parts.modelID)]
      if (!match || !isVisionModel(match)) {
        throw new Error(
          `vision_analyze: model not configured: ${visionToolModel} is not image-capable; set ` +
            'agent["vision-agent"].model to a vision-capable model',
        )
      }
      const endpoint = resolveVisionEndpoint(parts.provider, visionToolCatalog, visionToolConfig, process.env)
      if (!endpoint.ok) throw new Error(`vision_analyze: provider error: ${endpoint.error}`)
      const apiKey = resolveVisionApiKey(
        parts.provider,
        visionToolCatalog,
        visionToolConfig,
        readAuthData(),
        process.env,
      )
      if (!apiKey.ok) throw new Error(`vision_analyze: provider error: ${apiKey.error}`)
      const images: { id: string; path: string; base64: string }[] = []
      for (const image of args.images) {
        const path = isAbsolute(image.path) ? image.path : join(ctx.directory, image.path)
        if (!existsSync(path)) {
          throw new Error(`vision_analyze: missing image: ${path}`)
        }
        images.push({ id: image.id, path, base64: readFileSync(path).toString("base64") })
      }
      const request = buildVisionRequest(
        parts.modelID,
        endpoint.value,
        images,
        args.question,
        args.response_template,
        args.response_rules,
        apiKey.value,
      )
      const result = await postVisionRequest(request, { signal: ctx.abort, timeoutMs: VISION_TOOL_TIMEOUT_MS })
      if (!result.ok) throw new Error(`vision_analyze: provider error: ${result.error}`)
      const parsed = parseVisionResponse(result.text)
      if (!parsed.ok) throw new Error(`vision_analyze: invalid response: ${parsed.error}`)
      return parsed.text
    },
  })
}

const plugin: Plugin = async () => ({
  config: async (cfg) => {
  const catalog = readModelsCatalog()
  const dynamicModels = discoverVisionModels(catalog, cfg as ConfigLike)
  registeredModels = new Map(
    dynamicModels.map((m) => [`${m.provider}/${m.model_id}`, m])
  )

  // RV-1/RV-2: build per-agent capability state from the registered
  // vision model set and each configured agent's model. Built BEFORE the
  // single vision-agent registration below so it captures user-configured
  // agents; the subagent's own messages carry a vision info.model that wins
  // first in the transform.
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

  // Register the skill for discovery: push the package data dir (which
  // contains SKILL.md) onto config.skills.paths. Kilo scans **/SKILL.md under
  // each path, so the vision skill resolves straight out of the installed
  // package — no postinstall copy, no symlink, no module-load sync. This is
  // the only skill discovery mechanism; Method B (single-file) installs copy
  // SKILL.md manually per the README.
  const cfgAny = cfg as ConfigLike & {
    skills?: { paths?: string[] }
  }
  cfgAny.skills ??= {}
  cfgAny.skills.paths ??= []
  if (!cfgAny.skills.paths.includes(dataDir)) {
    cfgAny.skills.paths.push(dataDir)
  }

  // RV-6: register the single vision-agent subagent WITHOUT a default model.
  // The user supplies the model via the Kilo Code agent model override
  // (`agent["vision-agent"].model`); the plugin never writes `model` or
  // `disable`, so user overrides and disable stay effective. Kilo falls back
  // to the default model when none is set.
  cfg.agent ??= {}
  cfg.agent["vision-agent"] ??= {}
  Object.assign(cfg.agent["vision-agent"], {
    description: "Visual judgment subagent. Consumes a prompt-authored visual task with image paths and a task-specific JSON response template. Not coupled to any screenshot tool or UI framework - works with locally stored images supported by the model. Configure its model via the Kilo Code agent model override.",
    mode: "subagent",
    temperature: 0.1,
    prompt: bodyTpl,
    permission: PERMISSION,
  })

  // VT-2: capture the tool's model source (and the disable flag) from the
  // user's vision-agent override. Read-only: the plugin never writes these.
  const visionAgent = cfg.agent["vision-agent"] as
    | { model?: string; disable?: boolean }
    | undefined
  visionToolModel =
    typeof visionAgent?.model === "string" && visionAgent.model ? visionAgent.model : undefined
  visionToolDisabled = visionAgent?.disable === true
  visionToolConfig = cfg as ConfigLike
  visionToolCatalog = catalog
  },

  // VT-1/VT-2: register vision_analyze natively. A getter keeps the registry
  // view honest when the user disables vision-agent (disable: true -> the
  // tool is absent from the registry, matching the subagent being hidden).
  // execute() additionally guards against a disabled/absent state.
  get tool(): Record<string, import("@kilocode/plugin").ToolDefinition> {
    return visionToolDisabled ? {} : { [VISION_TOOL_NAME]: visionAnalyzeTool() }
  },

  // VT-3: upgrade ask -> allow for vision_analyze permission requests only.
  // An explicit user deny resolves before this hook and is never overwritten.
  // (Spike 1.2: Kilo 7.4.17 never dispatches this hook — custom tools run
  // without prompts and a deny removes the tool from the toolset — but
  // registering it preserves the auto-allow contract on runtimes that do.)
  "permission.ask": async (input, output) => {
    const key =
      (input as unknown as { permission?: string }).permission ?? input.id ?? input.type
    if (key === VISION_TOOL_NAME && output.status === "ask") {
      output.status = "allow"
    }
  },

  // Source D: materialize user-dropped images as stable paths that the
  // orchestrator can pass to the vision_analyze tool (or the vision-agent
  // subagent fallback).
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

  // The system transform tells the orchestrator how images are routed in
  // this session: a vision-capable model handles them natively, while a
  // text-only model sees [vision:dropped-image] markers and delegates via
  // the vision_analyze tool (falling back to the vision-agent subagent).
  // The model is configured by the user via the Kilo Code agent model
  // override on vision-agent. No model script or picker is involved.
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
          "do NOT delegate visual tasks to a vision-* subagent.",
      )
      return
    }
    // Text-only path: inject nothing. The vision skill (SKILL.md) instructs
    // the orchestrator to call the vision_analyze tool first and fall back
    // to the vision-agent subagent on provider errors; the model is
    // configured by the user via the Kilo Code agent model override.
  },
})

export default { id: "vision", server: plugin }
