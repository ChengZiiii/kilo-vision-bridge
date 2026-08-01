// Pure, testable core for the vision_analyze tool: request building,
// response parsing, endpoint and API key resolution, and the HTTP call.
// No imports from @kilocode/* and no side effects — imported directly by
// plugin.ts (bundled) and by tests (node --test with type stripping).
//
// Request shapes (resolved from the endpoint URL):
//  - "anthropic": Anthropic-style POST <base>/messages with base64 image
//    blocks. Empirically verified (spike 1.3) as the shape that delivers
//    images for minimax-cn-coding-plan / MiniMax-M3 on the reference
//    machine (https://api.minimaxi.com/anthropic/v1).
//  - "openai": OpenAI-compatible POST <base>/chat/completions with
//    `image_url` data: URLs. Works for genuine OpenAI-compatible providers.

export type VisionShape = "openai" | "anthropic"

export type VisionImage = {
  id: string
  path: string
  base64: string
}

export type VisionRequest = {
  shape: VisionShape
  url: string
  headers: Record<string, string>
  body: string
}

export type ResolutionResult<T> = { ok: true; value: T; source: string } | { ok: false; error: string }

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
}

/** Infer the mime type from a local image path's extension (default png). */
export function inferImageMime(path: string): string {
  const lower = path.toLowerCase()
  for (const [ext, mime] of Object.entries(MIME_BY_EXT)) {
    if (lower.endsWith(ext)) return mime
  }
  return "image/png"
}

/** Resolve the request shape from a base URL: /anthropic in the URL -> anthropic. */
export function visionShapeFor(baseURL: string): VisionShape {
  return /\/anthropic(?:\/|$)/i.test(baseURL) ? "anthropic" : "openai"
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "")
}

/**
 * Full request URL for a resolved base URL + shape.
 * openai:   <base>/v1/chat/completions (or <base>/chat/completions when the
 *           base already ends in /v1 or /chat/completions).
 * anthropic: <base>/messages (or <base>/v1/messages when the base ends in
 *           /anthropic, or <base>/anthropic/v1/messages for a bare host).
 */
export function visionRequestURL(baseURL: string): string {
  const base = trimSlash(baseURL)
  if (base.endsWith("/messages") || base.endsWith("/chat/completions")) return base
  if (visionShapeFor(baseURL) === "anthropic") {
    if (base.endsWith("/v1")) return `${base}/messages`
    if (base.endsWith("/anthropic")) return `${base}/v1/messages`
    return `${base}/anthropic/v1/messages`
  }
  if (base.endsWith("/v1")) return `${base}/chat/completions`
  return `${base}/v1/chat/completions`
}

/**
 * Build the HTTP request descriptor for a vision call. `images` carry the
 * already-read base64 payloads; mime is inferred from each `path` extension.
 * The question, response template and response rules are combined into the
 * text part of the first user message; one image is placed per user content
 * message (multi-image via multiple messages).
 */
export function buildVisionRequest(
  model: string,
  baseURL: string,
  images: VisionImage[],
  question: string,
  responseTemplate: string,
  responseRules?: string,
  apiKey?: string,
): VisionRequest {
  const shape = visionShapeFor(baseURL)
  const url = visionRequestURL(baseURL)

  const textParts: string[] = []
  if (question) textParts.push(question)
  if (responseTemplate) {
    textParts.push(
      `Return exactly one JSON object shaped like this. Keep these keys exactly, replace placeholder values with observed values, and do not add keys:\n\n${responseTemplate}`,
    )
  }
  if (responseRules) textParts.push(`Response rules:\n${responseRules}`)
  const text = textParts.join("\n\n")

  const messages: unknown[] = []
  for (const image of images) {
    const mime = inferImageMime(image.path)
    if (shape === "anthropic") {
      const content: unknown[] = []
      if (messages.length === 0 && text) {
        content.push({ type: "text", text })
      }
      content.push({
        type: "image",
        source: { type: "base64", media_type: mime, data: image.base64 },
      })
      messages.push({ role: "user", content })
    } else {
      const content: unknown[] = []
      if (messages.length === 0 && text) {
        content.push({ type: "text", text })
      }
      content.push({
        type: "image_url",
        image_url: { url: `data:${mime};base64,${image.base64}` },
      })
      messages.push({ role: "user", content })
    }
  }
  if (messages.length === 0) {
    messages.push({ role: "user", content: text })
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" }
  let body: unknown
  if (shape === "anthropic") {
    headers["x-api-key"] = apiKey ?? ""
    headers["anthropic-version"] = "2023-06-01"
    body = {
      model,
      max_tokens: 2048,
      temperature: 0.1,
      messages,
    }
  } else {
    headers["Authorization"] = `Bearer ${apiKey ?? ""}`
    body = {
      model,
      temperature: 0.1,
      messages,
    }
  }

  return { shape, url, headers, body: JSON.stringify(body) }
}

/**
 * Extract the model's text from a chat completion response and sanity-check
 * that it parses as a single JSON value. Accepts a raw string body or an
 * already-parsed object.
 */
export function parseVisionResponse(body: string | unknown): { ok: true; text: string } | { ok: false; error: string } {
  let parsed: unknown = body
  if (typeof body === "string") {
    try {
      parsed = JSON.parse(body)
    } catch {
      return { ok: false, error: "response is not valid JSON" }
    }
  }
  if (parsed === null || typeof parsed !== "object") {
    return { ok: false, error: "response is not a JSON object" }
  }
  const obj = parsed as Record<string, unknown>
  if (obj.type === "error") {
    const err = obj.error as Record<string, unknown> | undefined
    return { ok: false, error: `provider error: ${err?.message ?? JSON.stringify(err ?? obj)}` }
  }
  const choices = Array.isArray(obj.choices) ? (obj.choices as Array<Record<string, unknown>>) : []
  if (choices.length > 0) {
    const content = (choices[0]?.message as Record<string, unknown> | undefined)?.content
    if (typeof content !== "string" || content.trim() === "") {
      return { ok: false, error: "response has no choices[0].message.content text" }
    }
    return sanityCheckJSON(content)
  }
  const blocks = Array.isArray(obj.content) ? (obj.content as Array<Record<string, unknown>>) : []
  if (blocks.length > 0) {
    const text = blocks
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("")
    if (!text.trim()) {
      return { ok: false, error: "response has no anthropic text content block" }
    }
    return sanityCheckJSON(text)
  }
  return { ok: false, error: "response has neither choices[0].message.content nor content text blocks" }
}

function sanityCheckJSON(text: string): { ok: true; text: string } | { ok: false; error: string } {
  const trimmed = text.trim()
  try {
    const value = JSON.parse(trimmed)
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "model output is not a single JSON object" }
    }
    return { ok: true, text: trimmed }
  } catch {
    return {
      ok: false,
      error: `model output is not valid JSON: ${trimmed.length > 140 ? trimmed.slice(0, 140) + "…" : trimmed}`,
    }
  }
}

// Built-in map of known OpenAI-compatible / Anthropic-compatible vision
// endpoints for providers absent from the local model catalog. The minimax
// family maps to the anthropic-style base URL: the spike (1.3) verified that
// the OpenAI-compatible /chat/completions endpoint of api.minimaxi.com drops
// data: image_url parts (images never reach the model), while the
// anthropic-style /messages endpoint delivers them.
const VISION_ENDPOINTS: Record<string, string> = {
  "minimax": "https://api.minimax.io/anthropic/v1",
  "minimax-coding-plan": "https://api.minimax.io/anthropic/v1",
  "minimax-cn": "https://api.minimaxi.com/anthropic/v1",
  "minimax-cn-coding-plan": "https://api.minimaxi.com/anthropic/v1",
}

type ConfigLike = {
  provider?: Record<string, { options?: { baseURL?: string } }>
  providers?: Record<string, { options?: { baseURL?: string } }>
}

type RawProvider = {
  env?: string[]
  api?: string
}

type Catalog = Record<string, RawProvider>

function foldMatch(record: Record<string, unknown>, key: string): string | undefined {
  const folded = key.toLowerCase()
  return Object.keys(record).find((k) => k.toLowerCase() === folded)
}

/**
 * Resolve the vision provider's base URL in this order:
 *   1. provider.<id>.options.baseURL from config (user override wins)
 *   2. an endpoint from the provider's declared env vars (names ending in
 *      _HOST, e.g. MINIMAX_API_HOST)
 *   3. the provider's catalog `api` field, else the built-in endpoint map
 *   4. otherwise a descriptive error
 */
export function resolveVisionEndpoint(
  provider: string,
  catalog: Catalog,
  config: ConfigLike,
  env: Record<string, string | undefined>,
): ResolutionResult<string> {
  for (const section of [config.provider, config.providers]) {
    if (!section) continue
    const key = foldMatch(section as unknown as Record<string, unknown>, provider)
    if (key) {
      const baseURL = section[key]?.options?.baseURL
      if (typeof baseURL === "string" && baseURL.trim()) {
        return { ok: true, value: baseURL.trim(), source: "config" }
      }
    }
  }
  const catalogProvider = catalog[provider] ?? catalog[String(provider).toLowerCase()]
  if (catalogProvider) {
    for (const name of catalogProvider.env ?? []) {
      if (!/host/i.test(name)) continue
      const value = env[name]
      if (typeof value === "string" && value.trim()) {
        return { ok: true, value: value.trim(), source: "env" }
      }
    }
  }
  if (catalogProvider && typeof catalogProvider.api === "string" && /^https?:\/\//i.test(catalogProvider.api)) {
    return { ok: true, value: catalogProvider.api, source: "catalog" }
  }
  const folded = provider.toLowerCase()
  for (const [key, url] of Object.entries(VISION_ENDPOINTS)) {
    if (key.toLowerCase() === folded) return { ok: true, value: url, source: "builtin" }
  }
  return {
    ok: false,
    error: `no known endpoint for provider "${provider}": set provider.${provider}.options.baseURL in config`,
  }
}

/**
 * Resolve the vision provider's API key: the provider's auth.json entry
 * (type "api") first, then the provider's declared env vars.
 */
export function resolveVisionApiKey(
  provider: string,
  catalog: Catalog,
  _config: ConfigLike,
  auth: Record<string, unknown>,
  env: Record<string, string | undefined>,
): ResolutionResult<string> {
  const authKey = foldMatch(auth, provider)
  if (authKey) {
    const entry = auth[authKey] as Record<string, unknown> | undefined
    if (entry && typeof entry === "object" && entry.type === "api") {
      const key = typeof entry.key === "string" ? entry.key : typeof entry.apiKey === "string" ? entry.apiKey : undefined
      if (key && key.trim()) return { ok: true, value: key.trim(), source: "auth" }
    }
  }
  const catalogProvider = catalog[provider] ?? catalog[String(provider).toLowerCase()]
  for (const name of catalogProvider?.env ?? []) {
    const value = env[name]
    if (typeof value === "string" && value.trim()) {
      return { ok: true, value: value.trim(), source: "env" }
    }
  }
  return {
    ok: false,
    error: `no API key for provider "${provider}": authenticate via kilo auth or set ${(catalogProvider?.env ?? ["<provider>_API_KEY"]).join(", ")}`,
  }
}

export type PostResult = { ok: true; status: number; text: string } | { ok: false; error: string }

/**
 * POST a built VisionRequest. Injectable fetch (tests stub globalThis.fetch).
 * `signal` (e.g. ctx.abort) and `timeoutMs` are composed; non-2xx responses
 * and network failures map to descriptive provider errors.
 */
export async function postVisionRequest(
  request: VisionRequest,
  opts: { fetchImpl?: typeof fetch; signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<PostResult> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch
  const timeoutMs = opts.timeoutMs ?? 60_000
  const signals: AbortSignal[] = []
  if (opts.signal) signals.push(opts.signal)
  if (timeoutMs > 0) signals.push(AbortSignal.timeout(timeoutMs))
  const signal = signals.length === 1 ? signals[0] : AbortSignal.any(signals)
  try {
    const response = await fetchImpl(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal,
    })
    const text = await response.text()
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status} from ${request.url}: ${text.length > 300 ? text.slice(0, 300) + "…" : text}`,
      }
    }
    return { ok: true, status: response.status, text }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `network error: ${message}` }
  }
}
