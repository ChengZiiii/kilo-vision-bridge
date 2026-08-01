# Proposal: Per-agent vision routing (multimodal models keep native image input)

## Intent

Today the plugin's `experimental.chat.messages.transform` hook rewrites EVERY
image `FilePart` into a `[vision:dropped-image]` text marker, unconditionally.
A multimodal main model (e.g. GPT-5.6, MiniMax-M3) therefore loses its native
image input even though the startup gate (`configuredModelVisionCapable`)
already skipped subagent registration for it. The upstream design assumed a
text-only orchestrator; the transform never asked which model is actually
receiving the messages.

This change routes images per model capability:

- Multimodal model → image parts pass through untouched; the model sees
  images natively (its own path).
- Text-only model → image parts are materialized and rewritten as today;
  the vision skill delegates to a `vision-*` subagent.

## Scope

In scope:

- `plugin.ts`:
  - Track per-agent model capability at config time (agent `model` fields,
    top-level `model` fallback) alongside the registered vision model key set.
  - `experimental.chat.messages.transform`: rewrite image parts only for
    messages whose handling model is NOT vision-capable; leave image parts
    untouched otherwise.
  - `experimental.chat.system.transform`: use `input.model` to inject the
    native-vision instruction for multimodal models vs the existing
    model-script/model-choice instructions for text-only models.
  - Remove the global "skip all registration" gate: `vision-*` subagents are
    always registered so text-only agents can delegate; non-delegation for
    multimodal models is enforced by the transform/system hooks and the skill
    self-gate.
- `SKILL.md`: clarify when NOT to delegate (multimodal agent) and that image
  parts reach multimodal models natively.
- README: document the per-model routing behavior.

Out of scope:

- Video/audio input routing (still image-only).
- Changes to the picker script, subagent body, or temp-dir layout.
- Publishing.

## Approach

1. Build module-level capability state in the config hook:
   - `visionModelKeys`: folded `provider/model` set of all registered vision
     models (from the catalog, after merge).
   - `agentVisionCapable`: folded map agent name → capability, derived from
     each `cfg.agent[name].model` via `configuredModelVisionCapable`, with
     `defaultVisionCapable` from top-level `cfg.model`.
2. In the messages transform, for each user message resolve capability:
   `m.info.model` (providerID/modelID) folded lookup in `visionModelKeys`
   first; fall back to `m.info.agent` → `agentVisionCapable`; fall back to
   `defaultVisionCapable`. Vision-capable → skip rewriting (native path).
3. In the system transform, branch on `input.model` (folded lookup in
   `visionModelKeys`): multimodal → push a single "you see images natively,
   do not use the vision skill" instruction; text-only → push the existing
   `[vision:model-script]` + `[vision:model-choice]` instructions.
4. Remove the early-return gate in the config hook; keep
   `configuredModelVisionCapable` as the shared capability predicate.
5. Verify with the dist-bundle harness: multimodal-agent message not
   rewritten / system instruction branch / text-only path unchanged; plus
   `kilo agent list` after install still shows `vision-*`.
