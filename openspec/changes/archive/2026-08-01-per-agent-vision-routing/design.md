# Design

## 1. Capability state built at config time

The config hook already computes `dynamicModels` and `registeredModels`.
Extend it to also build, at module level (same pattern as `registeredModels`):

- `visionModelKeys: Set<string>` — folded (`toLowerCase()`) `provider/model`
  keys of every registered vision model. This is the O(1) lookup used by both
  the messages transform (per-message) and the system transform (per-request).
- `agentVisionCapable: Map<string, boolean>` — for each `cfg.agent[name]` with
  a `model` field, `configuredModelVisionCapable(model, catalog, cfg)`; agents
  without an explicit model inherit the top-level decision.
- `defaultVisionCapable: boolean` — `configuredModelVisionCapable(cfg.model,
  catalog, cfg)`.

Why not query the catalog per message? The transform runs on every LLM request
in every session; per-message catalog re-parse would be wasteful and the
registered set is exactly "models we consider vision-capable" — the same set
the gate used before, now retained instead of cleared.

## 2. Messages transform routing

For each user message:

1. If `m.info.model` is present and `providerID`/`modelID` are strings, fold
   `` `${providerID}/${modelID}` `` and check `visionModelKeys`. Hit →
   vision-capable, skip rewriting.
2. Else if `m.info.agent` is a string, look up `agentVisionCapable`. Hit →
   use it.
3. Else use `defaultVisionCapable`.

Vision-capable → `continue` (image parts untouched, native path).
Text-only → existing rewrite logic unchanged (materialize + `[vision:dropped-image]`).

Note: vision subagents' own sessions have a vision model in `info.model`, so
any image part inside a subagent message is never rewritten — semantically
correct (the subagent can see images).

## 3. System transform routing

`input.model` is `Model` (has `providerID`/`modelID`). Fold and check
`visionModelKeys`:

- vision-capable → `output.system.push("...you receive images natively... do
  not use the vision skill...")`
- else (or model missing) → existing `[vision:model-script]` +
  `[vision:model-choice]` push, unchanged.

## 4. Gate removal

Delete the config-hook early return:

```ts
if (configuredModelVisionCapable(cfg.model, catalog, cfg as ConfigLike)) {
  registeredModels = new Map()
  return
}
```

`vision-*` agents are always registered. Non-delegation for multimodal
models is enforced by RV-2's system instruction plus SKILL.md's self-gate
("When NOT to invoke"). Rationale: a multimodal main model coexisting with a
text-only agent needs the subagents; a pure-multimodal setup simply never
invokes them.

## 5. Files

| File | Change |
| ---- | ------ |
| `plugin.ts` | module-level capability state; transform routing (RV-1); system transform branch (RV-2); gate removal (RV-3) |
| `SKILL.md` | "When NOT to invoke" + Source D wording for the native path (RV-4) |
| `README.md` | per-model routing description (RV-4) |

## 6. Verification

- Harness (import dist, call config + transforms with synthetic messages):
  - multimodal `info.model` → part untouched
  - text-only `info.model` → marker + temp file
  - `info.model` vision + `info.agent` text-only → untouched (message wins)
  - unknown agent + multimodal `cfg.model` → untouched
  - system transform: vision `input.model` → native instruction only;
    text-only → script/choice instructions; missing model → text-only branch
  - config hook with vision-capable `cfg.model` → subagents still registered
- Live: re-run `kilo agent list` with the plugin installed to confirm
  registration intact.
- `bun run typecheck` + `bun run build`.

## 7. Commits

1. `plugin: route image parts and system hints by model capability`
2. `skill: document native-vision path for multimodal models`
3. `docs: describe per-model vision routing in README`
