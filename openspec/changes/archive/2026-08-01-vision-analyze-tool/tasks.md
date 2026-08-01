# Tasks

## 1. Spike: SDK capability + provider facts (before implementation)

- [x] 1.1 Verify on Kilo 7.4.17 (sandbox `KILO_TEST_HOME`): a plugin-registered
      `tool` hook tool is listed and callable from a subagent session
      (depth >= 1) without permission prompts when the `permission.ask`
      hook upgrades it
- [x] 1.2 Verify `permission.ask` hook fires for custom-tool requests and
      that an explicit user `deny` still wins (never overwritten)
- [x] 1.3 Resolve facts for `minimax-cn-coding-plan` on the reference
      machine: API key source (auth.json entry vs `MINIMAX_API_KEY` env),
      real base URL (config override / `MINIMAX_API_HOST` / built-in), and
      that `/chat/completions` with `image_url` parts works for MiniMax-M3
- [x] 1.4 Record findings in this tasks file (1.1-1.3) before proceeding

### SPIKE FINDINGS (recorded 2026-08-02, Kilo 7.4.17, sandbox KILO_CONFIG_DIR/KILO_DATA_DIR)

**1.1 — tool hook tool listed + callable from subagent session.**
- Plugins load from the config `plugin` array via `file://` pointing at a
  package DIRECTORY with `package.json` (a bare `.mjs` file path is silently
  ignored). Runtime `import "@kilocode/plugin"` resolves from the plugin
  file's own node_modules chain (standard ESM resolution) — a bare file in
  `~/.config/kilo/plugin/` (Method B) has NO node_modules, so the shipped
  plugin must BUNDLE `@kilocode/plugin` + zod into `dist/index.js` for the
  tool hook to work from a single-file install. (Current `bun build
  --packages external` keeps the import external and would fail at load.)
- A `tool` hook tool (`spike_probe`) was listed in the session toolset and
  called successfully from BOTH the primary `code` session and a spawned
  subagent session (`spike-child`, depth >= 1) — no permission prompt, no
  config needed. Tool execute runs in-process with `ctx.sessionID`,
  `ctx.agent` available.
- The `permission.ask` hook is **NOT dispatched by the runtime at all**:
  the trigger-name table embedded in kilo.exe contains no
  `permission.ask` (it has config/chat/tool.execute.*/messages/system
  transforms etc.). The SDK type declares it, but Kilo 7.4.17 never calls
  it. Registering the hook is harmless (and future-proof) but it can never
  fire on this version.

**1.2 — permission behavior for custom tools.**
- NO permission rule -> tool runs without any prompt (default).
- `permission.<tool> = "ask"` -> no prompt either; registry/plugin tool
  execution does not call the Permission service (only deny-filtering at
  toolset build). An "ask" rule for a custom tool is inert.
- `permission.<tool> = "deny"` -> the tool is REMOVED from the session
  toolset entirely ("No tool named spike_probe exists in this session..."),
  so the call cannot happen. Explicit user deny WINS; there is no hook to
  overwrite it.
- In non-interactive `kilo run`, built-in tool asks (e.g. `bash`) are
  auto-rejected by the client ("permission requested ...; auto-rejecting").
  Not applicable to plugin tools (they never ask).

**1.3 — minimax-cn-coding-plan facts (reference machine).**
- API key source: `~/.local/share/kilo/auth.json` entry
  `minimax-cn-coding-plan = { type: "api", key: "sk-cp-..." }` — CONFIRMED.
  `MINIMAX_API_KEY` is NOT set in the process env; it only exists inside the
  (disabled) MCP config block, which is MCP-scoped and not inherited.
- Catalog (`~/.cache/kilo/models.json`): `minimax-cn-coding-plan` has
  `api: "https://api.minimaxi.com/anthropic/v1"`, `env: ["MINIMAX_API_KEY"]`
  (no HOST var declared), `npm: "@ai-sdk/anthropic"`,
  `MiniMax-M3` input modalities = text,image,video.
- Live probes (real key, 2026-08-02):
  - `https://api.minimaxi.com/v1/chat/completions` (OpenAI shape):
    text works (200); **data: base64 image_url parts are SILENTLY DROPPED**
    — model answers "no image provided" (tested 8x8 red PNG, 64x64 blue
    PNG, with and without mime prefix). Hosted http(s) URL images DO work
    (model answered "Pink" for httpbin.org/image/png).
  - `https://api.minimaxi.com/anthropic/v1/messages` (Anthropic shape,
    `x-api-key` + `anthropic-version` headers, `content[].image` base64
    blocks): images ARE seen ("Red" / "Blue"). This is the shape Kilo's own
    provider plumbing uses for this provider (npm @ai-sdk/anthropic).
  - `https://api.minimax.io/...` (international) rejects the CN key (401).
- CONCLUSION for the tool: the OpenAI-compatible /chat/completions shape
  with data URLs does NOT deliver images to MiniMax-M3 on this machine. The
  core request builder therefore supports TWO shapes and resolves the shape
  from the resolved endpoint URL: `/anthropic/` in the base URL -> Anthropic
  `/messages` shape with base64 image blocks; otherwise OpenAI-compatible.
  Endpoint resolution: config `options.baseURL` (user wins; shape inferred
  from URL) -> provider env HOST var (none declared for minimax) -> catalog
  `api` field / built-in map (minimax family -> the anthropic-style URL
  above, which is the empirically working endpoint) -> descriptive error.

## 2. Core module: src/vision-http.ts (pure, testable)

- [x] 2.1 `buildVisionRequest(model, baseURL, images, question, rules)`:
      OpenAI-compatible body, one image per user content message, mime
      inferred from path extension
- [x] 2.2 `parseVisionResponse(body)`: extract `choices[0].message.content`,
      JSON sanity parse, descriptive errors
- [x] 2.3 `resolveVisionEndpoint(provider, catalog, config, env)`:
      config `options.baseURL` -> env host -> built-in map -> error
- [x] 2.4 `resolveVisionApiKey(provider, catalog, config, auth)`:
      auth.json (type `api`) -> provider env vars -> error

## 3. plugin.ts: tool registration

- [x] 3.1 Capture `visionToolModel` (from `agent["vision-agent"].model`) and
      the `disable` flag in the config hook; never write either field
- [x] 3.2 Register `vision_analyze` via the `tool` hook (zod args: `images`
      `[{id, path}]`, `question`, `response_template`, `response_rules`);
      skip registration when `disable: true`
- [x] 3.3 `execute`: model-unset / non-image-capable -> fixable error (no
      HTTP); endpoint + key resolution; read images (missing path ->
      error); fetch with `ctx.abort` + ~60s timeout; return JSON text
- [x] 3.4 Add `permission.ask` hook: upgrade `ask` -> `allow` for
      `vision_analyze` only; never touch `deny`

## 4. SKILL.md: tool-first routing

- [x] 4.1 Step 4: model knob unchanged; routing note (tool-first, fallback
      triggers, no-fallback on "model not configured")
- [x] 4.2 Step 5: primary path calls `vision_analyze` with
      `images[{id,path}]`, `question`, `response_template`,
      `response_rules`; fallback path keeps the existing
      `vision-agent` spawning template
- [x] 4.3 Keep Step 1/2/3/6 (detect/extract/gather/parse) and the
      native-vision gate intact

## 5. Tests

- [x] 5.1 `tests/vision-http.test.mjs` with stubbed `globalThis.fetch`:
      request shape, multi-image assembly, mime inference, response
      parsing, endpoint/key resolution order, error mapping
- [x] 5.2 `node --test tests/` green

## 6. README.md

- [x] 6.1 Document tool-first architecture, single model knob, auto-allowed
      permission (user deny wins), disable semantics, and that the tool
      path removes the need for `subagent_depth` / `permission.task` config

## 7. Verification

- [x] 7.1 `bun run typecheck`, `bun run build`, `node --test tests/`
- [x] 7.2 Live (sandbox): tool listed; orchestrator session: dropped image ->
      `vision_analyze` called and JSON parsed
- [x] 7.3 Live (sandbox): subagent session with a screenshot -> tool called
      without task permission prompts
- [x] 7.4 Live: `disable: true` -> tool absent; provider error -> skill
      falls back to `vision-agent`
- [x] 7.5 Manual e2e on the reference machine with the real MiniMax key
      (via `vision_analyze` end-to-end: real key, real model, real image
      file -> template-shaped JSON returned; earlier direct API probes in
      spike 1.3 confirmed image delivery: "Red"/"Blue" answers)

## 8. Commits

- [x] 8.1 `plugin: register vision_analyze tool with subagent fallback`
- [x] 8.2 `skill: route vision delegation tool-first`
- [x] 8.3 `tests: cover vision-http core`
- [x] 8.4 `docs: describe tool-first architecture`
