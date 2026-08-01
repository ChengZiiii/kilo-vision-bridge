# Proposal: User-configured vision-agent model

## Intent

The plugin currently drives `vision-agent`'s model from a persisted choice
file (`vision-model-image.txt`) written by `vision-models.mjs --model`. The
user wants zero plugin-managed model state: the plugin registers
`vision-agent` WITHOUT setting a model (default = unset), and the user
specifies the model entirely through Kilo Code's agent model override. The
persisted-choice machinery is removed. Kilo's built-in agent disable
(`agent.<name>.disable = true`, verified: disabled agents disappear from
`kilo agent list`) lets the user turn the subagent off entirely.

## Scope

In scope:

- `plugin.ts`: remove `visionChoiceFile` / `readPersistedChoice`, the
  choice-driven registration branch, and the `[vision:model-choice]` system
  prompt injection. Register `vision-agent` unconditionally WITHOUT a
  `model` field (user override supplies it). Keep `[vision:model-script]`
  as a read-only query hint.
- `subagent-body.md`: drop the `{{model_name}}` / `{{provider}}` /
  `{{model_id}}` placeholders (no model is known at registration).
- `scripts/vision-models.mjs`: remove persistence (`--model` writes,
  choice-file reads/writes, `persistedChoice` output); keep the read-only
  model listing (`models[]`, `--all`).
- `SKILL.md` / README: model specification is a Kilo Code agent-model
  override on `vision-agent`; the script is a read-only listing tool;
  disabling `vision-agent` in Kilo Code disables delegation.

Out of scope:

- Per-message / per-request capability routing (RV-1/RV-2) — unchanged.
- Model discovery and ranking in the script — unchanged.
- Publishing.

## Approach

1. Config hook: always register `cfg.agent["vision-agent"]` (description,
   mode, temperature, prompt, permission) and do NOT set `model`.
   User-configured fields (including a model override or `disable: true`)
   survive because the hook never writes them.
2. Delete the choice-file plumbing from the plugin and the script.
3. Skill/README: override-based model specification + disable guidance.
