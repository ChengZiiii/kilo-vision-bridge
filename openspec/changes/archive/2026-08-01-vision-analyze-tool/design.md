# Design

## 1. Native tool registration (`plugin.ts`)

The plugin's `Hooks` object gains a `tool` field:

```ts
import { tool } from "@kilocode/plugin"

tool: {
  vision_analyze: tool({
    description: "...",
    args: {
      images: tool.schema.array(tool.schema.object({
        id: tool.schema.string(),
        path: tool.schema.string(),
      })),
      question: tool.schema.string(),
      response_template: tool.schema.string(),
      response_rules: tool.schema.optional(tool.schema.string()),
    },
    async execute(args, ctx) { /* see below */ },
  }),
}
```

- Tool name constant `vision_analyze`; permission key = tool name
  (`permission.vision_analyze` in config).
- `execute` runs in the plugin process; it has access to module state
  (catalog, config snapshot, `readAuthData`). Returns the model's raw JSON
  text as the tool output (the skill parses it, same contract as the
  subagent path).
- If `agent["vision-agent"].disable === true` at config time, the tool is
  NOT registered (delegation fully off, matching today's disable semantics).

## 2. Model source: unchanged knob (VT-2)

- Config hook captures `visionToolModel = cfg.agent["vision-agent"]?.model`
  (string `provider/model`). The plugin never writes it — RV-6 stays intact.
- `execute` behavior:
  - model unset -> return a clear error naming the fix
    (`agent["vision-agent"].model`), do NOT invent a default.
  - model not image-capable per catalog -> same treatment.
- `vision-agent` remains registered and keeps its own fallback role.

## 3. Permission: auto-allow with explicit-deny precedence (VT-3)

```ts
"permission.ask": async (input, output) => {
  if (input.permission === "vision_analyze" && output.status === "ask") {
    output.status = "allow"
  }
}
```

- Upgrades only `ask` -> `allow`; a user-configured `deny` resolves to
  `deny` before/without the hook and is never overwritten.
- Confirmed by the user as desired behavior (no per-call prompts).

## 4. Endpoint and credential resolution (VT-5)

Order of resolution for the vision model's `provider`:
1. `provider.<id>.options.baseURL` in config (user override wins).
2. `MINIMAX_API_HOST`-style env when the provider's env list declares it.
3. The provider's catalog `api` field (e.g. the models.dev catalog entry
   for `minimax-cn-coding-plan` declares
   `api: https://api.minimaxi.com/anthropic/v1`).
4. Built-in map of known vision endpoints (minimax family →
   anthropic-style base URLs; see request-shape section above).
5. Unresolved -> clear error; the skill then falls back to the subagent
   (Kilo's own provider plumbing may succeed where the HTTP path failed).

API key: `readAuthData()` entry for the provider (type `api`) first, then
env vars from the provider's `env` list (e.g. `MINIMAX_API_KEY`).

Request shape (two styles, selected by the resolved endpoint URL —
`src/vision-http.ts` `visionShapeFor`):

- **OpenAI-compatible** (`<base>/chat/completions`), used when the base URL
  carries no `/anthropic` marker:

```json
{
  "model": "<modelID>",
  "temperature": 0.1,
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "<question>" },
      { "type": "image_url", "image_url": { "url": "data:<mime>;base64,..." } }
    ]
  }]
}
```

- **Anthropic-style** (`<base>/messages`, e.g.
  `https://api.minimaxi.com/anthropic/v1/messages`), used when the base URL
  contains `/anthropic`:

```json
{
  "model": "<modelID>",
  "max_tokens": 2048,
  "temperature": 0.1,
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "<question>" },
      { "type": "image", "source": { "type": "base64", "media_type": "<mime>", "data": "..." } }
    ]
  }]
}
```

Rationale for the split (spike 1.3): the reference provider
`minimax-cn-coding-plan` / MiniMax-M3 silently drops `data:` `image_url`
parts on its OpenAI-compatible `/v1/chat/completions` endpoint (the model
answers "no image provided"), while its Anthropic-style
`/anthropic/v1/messages` endpoint delivers base64 images. The shape is
therefore a function of the resolved endpoint URL, not a constant. The
built-in endpoint map (minimax family) points at the anthropic-style base
URLs so the primary path works out of the box.

- One image per user content message (multi-image via multiple messages),
  mime inferred from the path extension.
- `ctx.abort` wired to the fetch signal; ~60s timeout.
- Response parsed from `choices[0].message.content` (OpenAI) or
  `content[]` text blocks (Anthropic); a light JSON sanity check with a
  descriptive error on failure (the skill retries once per Step 6 anyway).

## 5. Core extracted for tests

New module (e.g. `src/vision-http.ts`, bundled into `dist/index.js` by the
existing `bun build` and imported directly by tests):

- `buildVisionRequest(model, baseURL, images, question, rules)` -> body
- `parseVisionResponse(body)` -> text | error
- `resolveVisionEndpoint(provider, catalog, config, env)` -> baseURL | error
- `resolveVisionApiKey(provider, catalog, config, auth)` -> key | error

`tests/vision-http.test.mjs` (node --test, `fetch` stubbed via
`globalThis.fetch`) covers request shape, multi-image assembly, mime
inference, response parsing, endpoint/key resolution order, and error
mapping. First test harness in the repo (script already exists in
package.json).

## 6. SKILL.md routing (VT-4)

- Step 4 stays "model is user-configured" (same override), plus a routing
  note: tool-first, subagent fallback.
- Step 5 becomes two paths:
  1. Primary: call `vision_analyze` with `images[{id,path}]`, `question`,
     `response_template` (the same template rules as today), `response_rules`.
  2. Fallback: when the tool is not present in the current session's toolset,
     or the call fails with a provider/protocol/HTTP error -> spawn
     `vision-agent` (existing template unchanged).
  3. No fallback on "model not configured" — surface the error and tell the
     user to set `agent["vision-agent"].model`.
- Step 6 (parse/retry/cite) unchanged.

## 7. Files

| File | Change |
| ---- | ------ |
| `src/vision-http.ts` | new pure core (request/response/endpoint/key helpers) |
| `plugin.ts` | tool hook, permission.ask hook, model capture, disable gating |
| `SKILL.md` | tool-first routing + fallback triggers (Step 4/5) |
| `tests/vision-http.test.mjs` | new test harness (stubbed fetch) |
| `README.md` | architecture, model knob, permission behavior |

## 8. Verification

- Unit: `node --test tests/` (core helpers, stubbed fetch).
- `bun run typecheck`, `bun run build`.
- Live (sandbox, KILO_TEST_HOME): `kilo tool` / agent list shows the tool;
  orchestrator session: dropped image -> `vision_analyze` called and JSON
  parsed; subagent session (playwright screenshot) -> tool called without
  task permission prompts; `disable: true` -> tool absent.
- Fallback: force a provider error -> skill routes to `vision-agent`.
- Manual e2e on the reference machine with the real MiniMax key.

## 9. Risks / spike items (first apply tasks)

- Whether the `tool` hook's tools and the `permission.ask` hook are honored
  inside subagent sessions (depth >= 1) — verify before building everything.
- Exact env/auth source for `minimax-cn-coding-plan` on the reference
  machine (auth.json entry vs `MINIMAX_API_KEY`) and its real baseURL.
