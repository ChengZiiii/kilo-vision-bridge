# Proposal: Native vision_analyze tool with subagent fallback

## Intent

Text-only subagents (libretto-apply/libretto-verify, compose-dev/compose-review)
cannot delegate to the `vision-agent` subagent: Kilo's `subagent_depth`
defaults to 1 (subagents cannot launch subagents) and subagent sessions
auto-deny the `task` tool. The vision skill is readable inside subagents but
its only delegation path (spawn `vision-agent`) is blocked.

This change adds a **native plugin tool** `vision_analyze` (registered via
the `@kilocode/plugin` `tool` hook) that performs the visual judgment
in-process — no subagent nesting required. The skill routes tool-first and
falls back to the `vision-agent` subagent when the tool is unavailable or
errors. The vision model knob stays exactly where it is today: the user's
`agent["vision-agent"].model` override. `disable: true` on `vision-agent`
turns the whole delegation off (tool not registered).

## Scope

In scope:

- `plugin.ts`: register the `vision_analyze` tool (zod args: `images`
  `[{id, path}]`, `question`, `response_template`, `response_rules`),
  implement `execute` (read images -> base64 -> OpenAI-compatible chat
  completion against the configured vision model -> return JSON), add a
  `permission.ask` hook that auto-allows `vision_analyze` requests (never
  downgrades an explicit `deny`), capture `agent["vision-agent"].model` at
  config time as the tool's model source, and skip tool registration when
  `agent["vision-agent"].disable` is true.
- New pure-function core (importable by tests) for prompt assembly, HTTP
  request building, and response parsing.
- `SKILL.md`: Step 4/5 rewrite — call `vision_analyze` first; fall back to
  spawning `vision-agent` only when the tool is unavailable in the session
  or the call errors (provider/protocol failure); "model not configured" is
  surfaced to the user, not routed to the fallback. Model knob and disable
  semantics unchanged.
- `tests/*.test.mjs`: first test harness for the pure core (stubbed fetch).
- `README.md`: document the tool-first architecture and the unchanged model
  configuration.
- openspec spec delta: ADDED VT-1..VT-5, MODIFIED RV-4/RV-6/RB-7.

Out of scope:

- The `subagent_depth` / `permission.task` config changes on the user's
  Kilo — the tool path makes them unnecessary (documented in README).
- `[vision:dropped-image]` messages transform and `[vision:native]` system
  transform routing — unchanged.
- Removing the `vision-agent` subagent — it stays registered as the model
  knob, the fallback path, and the manual `@vision-agent` entry point.
- Non-OpenAI-compatible providers: v1 covers OpenAI-compatible endpoints
  (MiniMax M3); other protocols keep working through the subagent fallback.

## Approach

1. Config hook: read `agent["vision-agent"].model` (model source) and
   `disable` flag; keep registering `vision-agent` as today (RV-6 intact).
2. `tool` hook: register `vision_analyze`; `execute` resolves
   provider/model/endpoint/credentials (config `options.baseURL` ->
   built-in endpoint map -> clear error), reads images, calls the model,
   returns the model's JSON text.
3. `permission.ask` hook: upgrade `ask` -> `allow` for `vision_analyze`
   only; explicit user `deny` passes through untouched.
4. Skill: tool-first routing with documented fallback triggers.
5. Verify on-machine: tool visible in `kilo tool` list, works from a
   subagent session (screenshot -> visual verdict), fallback triggers.
