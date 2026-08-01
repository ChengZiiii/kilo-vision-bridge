# Tasks

## 1. plugin.ts: capability state (RV-1/RV-3)

- [x] 1.1 Add module-level `visionModelKeys` (folded `provider/model` set from
      `registeredModels`), `agentVisionCapable` map, `defaultVisionCapable`
- [x] 1.2 Populate them in the config hook (agents with `model` via
      `configuredModelVisionCapable`; fallback chain per design §1)
- [x] 1.3 Remove the global gate early return (always register `vision-*`
      subagents); keep `configuredModelVisionCapable` as the predicate

## 2. plugin.ts: transform routing (RV-1)

- [x] 2.1 `experimental.chat.messages.transform`: resolve capability per user
      message (info.model → visionModelKeys; info.agent → agentVisionCapable;
      defaultVisionCapable) and skip rewriting for vision-capable messages
- [x] 2.2 Text-only path keeps existing materialize + marker behavior

## 3. plugin.ts: system transform branch (RV-2)

- [x] 3.1 `experimental.chat.system.transform`: branch on `input.model`
      (folded lookup in visionModelKeys); vision-capable → native-vision
      instruction only; else → existing script/choice instructions

## 4. SKILL.md and README (RV-4)

- [x] 4.1 SKILL.md: "When NOT to invoke" states multimodal models get images
      natively and must not delegate; Source D notes the marker appears only
      for text-only models
- [x] 4.2 README: describe per-model routing (multimodal native path vs
      text-only delegation)

## 5. Verification

- [x] 5.1 Harness: multimodal info.model → part untouched; text-only
      info.model → marker + temp file; message model beats agent map;
      unknown agent falls back to cfg.model
- [x] 5.2 Harness: system transform vision model → native instruction only;
      text-only → script/choice; missing model → text-only branch
- [x] 5.3 Harness: config hook with vision-capable cfg.model still registers
      subagents (RV-3)
- [x] 5.4 `bun run typecheck`, `bun run build`
- [ ] 5.5 Live: `kilo agent list` with plugin installed still shows `vision-*`
      (optional if harness covers registration)

## 6. Commits

- [x] 6.1 `plugin: route image parts and system hints by model capability`
- [x] 6.2 `skill: document native-vision path for multimodal models`
- [x] 6.3 `docs: describe per-model vision routing in README`
