# Tasks

## 1. plugin.ts + subagent-body.md: no default model

- [x] 1.1 Delete `visionChoiceFile` and `readPersistedChoice`
- [x] 1.2 Register `cfg.agent["vision-agent"]` unconditionally WITHOUT a
      `model` field; never write `model` or `disable`
- [x] 1.3 Rewrite `subagent-body.md` placeholder-free; drop `replaceAll`
      calls in the plugin
- [x] 1.4 System transform: remove `[vision:model-choice]` injection; keep
      `[vision:model-script]` as a read-only listing hint (drop the
      "Persist a choice with --model" sentence); update `[vision:native]`
      text

## 2. scripts/vision-models.mjs: read-only

- [x] 2.1 Remove persistence: `--model` write path, choice-file
      read/write, `persistedChoice`/`saved`/`selectionRequired`/`choiceFile`
      outputs
- [x] 2.2 Keep read-only listing (`models[]`, `--all`, caps, ranking,
      `subagentType: "vision-agent"`); `--model` validates but writes
      nothing (unknown model still exits non-zero)

## 3. SKILL.md

- [x] 3.1 Model specification = Kilo Code agent model override on
      `vision-agent` (no plugin persistence)
- [x] 3.2 `vision-models.mjs` described as read-only listing; disable
      guidance (Kilo Code agent disable / `disable: true`)
- [x] 3.3 Delete `vision-model-image.txt` / `[vision:model-choice]` /
      "next launch" persistence wording

## 4. README.md

- [x] 4.1 Describe no-default-model registration, override-based model
      spec, disable option, read-only script

## 5. Verification

- [x] 5.1 Harness: `vision-agent` registered with NO model; user override
      preserved; `disable: true` preserved
- [x] 5.2 Harness: system transform injects no `[vision:model-choice]`;
      script output has no `persistedChoice`/`saved`, `subagentType ===
      "vision-agent"`
- [x] 5.3 `bun run typecheck`, `bun run build`
- [x] 5.4 Live (sandbox): `kilo agent list` shows exactly one `vision-agent`
      (no model); with `disable: true` it disappears; with an override the
      override is preserved

## 6. Commits

- [x] 6.1 `plugin: register vision-agent without a default model`
- [x] 6.2 `scripts: make vision-models listing read-only`
- [x] 6.3 `skill: instruct kilo-code model override for vision-agent`
- [x] 6.4 `docs: describe user-configured vision-agent model`
