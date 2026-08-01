# Design

## 1. plugin.ts: unconditional registration without a model

- Delete `visionChoiceFile()` and `readPersistedChoice()` entirely.
- Config hook: always register `cfg.agent["vision-agent"]` with
  `description`, `mode: "subagent"`, `temperature: 0.1`, `prompt`, and
  `permission` — and do NOT set `model`. Because the hook never writes
  `model` or `disable`, a user's Kilo Code model override and any
  `disable: true` survive untouched.
- `bodyTpl`: the `{{model_name}}` / `{{provider}}` / `{{model_id}}`
  placeholders have no values anymore. Rewrite `subagent-body.md` as a
  placeholder-free generic body and drop the `replaceAll` calls in the
  plugin (keep the degraded-mode fallback string).
- System transform: delete the `readPersistedChoice()` +
  `[vision:model-choice]` injection. Keep `[vision:model-script]` as a
  read-only hint ("list available image-capable models with node
  scripts/vision-models.mjs") — remove the "Persist a choice with --model"
  sentence. The `[vision:native]` text drops the `[vision:model-choice]`
  mention.

## 2. scripts/vision-models.mjs: read-only

Remove the persistence machinery: `--model` write path, choice-file
read/write, `persistedChoice` / `selectionRequired` / `saved` outputs,
`choiceFile` field. Keep: discovery, ranking, caps, `--all`, `models[]`
listing, `subagentType: "vision-agent"`, and a `saved: false`-free output
shape (read-only semantics). `--model` becomes a validation-only flag (or
is rejected with a "read-only" message — pick the smallest change that
keeps "Unknown model rejected" behavior: validate, report, write nothing).

## 3. SKILL.md and README

- Model specification: the user sets the vision model via the Kilo Code
  agent model override on `vision-agent` (no plugin persistence).
- `vision-models.mjs` is a read-only listing tool (what models are
  available to override with).
- Disabling: set `disable: true` on the agent (Kilo Code agent disable) to
  stop delegation; verified that disabled agents disappear from
  `kilo agent list`.
- Delete all `vision-model-image.txt` / `[vision:model-choice]` /
  "next launch takes effect" persistence flow wording.

## 4. Files

| File | Change |
| ---- | ------ |
| `plugin.ts` | remove choice plumbing; register without model; read-only model-script |
| `subagent-body.md` | placeholder-free body |
| `scripts/vision-models.mjs` | remove persistence; read-only |
| `SKILL.md` | override-based model spec + disable guidance |
| `README.md` | same |

## 5. Verification

- Harness: config hook registers `vision-agent` with NO model field; user
  override preserved; `disable: true` preserved (and hidden in a sandbox
  `kilo agent list`); system transform injects no `[vision:model-choice]`;
  script output has no `persistedChoice`/`saved` state and
  `subagentType === "vision-agent"`.
- typecheck + build.
- Live (sandbox): `kilo agent list` shows exactly one `vision-agent` with
  no model; with `disable: true` it disappears; override via config shows
  the override.

## 6. Commits

1. `plugin: register vision-agent without a default model`
2. `scripts: make vision-models listing read-only`
3. `skill: instruct kilo-code model override for vision-agent`
4. `docs: describe user-configured vision-agent model`
