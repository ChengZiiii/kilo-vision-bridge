# Proposal: Single configurable vision subagent

## Intent

The plugin currently registers one `vision-*` subagent per discovered
image-capable model (177 on the reference machine). That is overkill: the
orchestrator delegates one visual task at a time and only ever needs a single
delegate. This change collapses registration to ONE subagent named
`vision-agent` whose model is driven by the persisted vision-model choice
(`~/.config/kilo/vision-model-image.txt`). Switching the vision model means
updating the choice file via the existing script; the config hook re-reads it
on every launch, so the change takes effect on restart (the VS Code extension
auto-refreshes on save — no editor restart needed).

## Scope

In scope:

- `plugin.ts` config hook: replace the per-model registration loop with a
  single `vision-agent` registration whose `model` is the persisted choice
  (case-insensitive match, canonical casing). No choice file → no
  `vision-agent` registered (the skill instructs the user to pick a model
  first). Remove the now-unused `subagentName` helper.
- `scripts/vision-models.mjs`: `subagentType` output becomes the constant
  `vision-agent` instead of per-model names.
- `SKILL.md`: delegation targets `vision-agent`; model switching documented
  (run script with `--model`, takes effect on next launch / VS Code refresh).
- README: single-subagent model + switching flow.

Out of scope:

- Per-message / per-request capability routing (RV-1/RV-2) — unchanged.
- Model discovery, ranking, and picker logic in the script — unchanged.
- The `vision-model-image.txt` persistence format — unchanged.
- Publishing.

## Approach

1. Config hook: read the persisted choice via the existing
   `readPersistedChoice()` (folded match against discovered models, returns
   the canonical key). If present, register `cfg.agent["vision-agent"]` with
   that model; else register nothing.
2. Script: `subagentType: "vision-agent"` in all outputs; delete the
   per-model name builder.
3. Skill/README: single-delegate wording + switch flow.
