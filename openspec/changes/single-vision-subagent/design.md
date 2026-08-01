# Design

## 1. Single registration in the config hook

Replace the `for (const e of dynamicModels)` registration loop (and the
`subagentName()` helper) with:

1. Resolve the persisted choice via the existing `readPersistedChoice()` —
   it already folds the choice line against `registeredModels` keys and
   returns the canonical registered key when the choice is a discovered
   image-capable model.
2. If a choice resolves: register `cfg.agent["vision-agent"]` with
   `model: choice`, the existing subagent body template, and the existing
   permission set.
3. If not: register nothing. The skill then instructs the user to pick a
   model first (script `--model`).

The capability state for RV-1/RV-2 routing (`visionModelKeys`,
`agentVisionCapable`, `defaultVisionCapable`) is unaffected — routing keys
off the registered model set, which still contains every discovered vision
model.

## 2. Script subagentType

`scripts/vision-models.mjs` currently emits `subagentType` built from
`subagentName(providerID, modelKey)` at three sites (list collection, save,
select). Replace with the constant `"vision-agent"` and delete the name
builder. Picker ranking, caps, and `--model` persistence logic stay
unchanged.

## 3. Skill and README

- SKILL.md Step 5 (Delegate): `subagent_type: "vision-agent"` — fixed,
  no model-name matching.
- SKILL.md Step 4 (Pick model): switching the vision model = run
  `node scripts/vision-models.mjs --model <provider/model>`; the change
  takes effect on the next launch (VS Code extension auto-refreshes on
  save; no editor restart).
- README: describe the single `vision-agent` and the switching flow.

## 4. Files

| File | Change |
| ---- | ------ |
| `plugin.ts` | single-agent registration; remove loop + `subagentName` |
| `scripts/vision-models.mjs` | `subagentType` constant |
| `SKILL.md` | fixed delegate + switch flow |
| `README.md` | single-agent + switch flow |

## 5. Verification

- Harness (temp, not committed): config hook with a persisted choice →
  exactly one `vision-agent` with the canonical chosen model and no other
  `vision-*` agents; no choice → no registration; mixed-case choice →
  canonical; script output `subagentType === "vision-agent"`.
- `bun run typecheck` + `bun run build`.
- Live (local install, sandbox-safe): reinstall the built plugin;
  `kilo agent list` shows exactly one `vision-agent`; switch the choice via
  the script, relaunch, agent list shows the new model.

## 6. Commits

1. `plugin: register a single configurable vision-agent subagent`
2. `scripts: emit fixed vision-agent subagentType`
3. `skill: delegate to single vision-agent subagent`
4. `docs: describe single vision-agent and model switching`
