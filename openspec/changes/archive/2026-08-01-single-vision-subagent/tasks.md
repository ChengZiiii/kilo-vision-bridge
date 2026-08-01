# Tasks

## 1. plugin.ts: single vision-agent registration

- [x] 1.1 Delete the per-model registration loop and the `subagentName`
      helper
- [x] 1.2 Register `cfg.agent["vision-agent"]` from the persisted choice
      (canonical, folded match via `readPersistedChoice()`) when it resolves
- [x] 1.3 No persisted choice → no registration (skill instructs picking a
      model first)

## 2. scripts/vision-models.mjs: fixed subagentType

- [x] 2.1 Replace the `subagentName(...)` builder with the constant
      `"vision-agent"` at all output sites (collection, save, select)

## 3. SKILL.md

- [x] 3.1 Delegation targets the fixed `vision-agent` subagent (no
      per-model name matching)
- [x] 3.2 Model-switch flow documented (script `--model` → next launch /
      VS Code config auto-refresh)

## 4. README.md

- [x] 4.1 Describe the single `vision-agent` and the model-switching flow

## 5. Verification

- [x] 5.1 Harness: persisted choice → exactly one `vision-agent` with the
      canonical model, no other `vision-*` agents; no choice → no
      registration; mixed-case choice → canonical
- [x] 5.2 Harness: script output `subagentType === "vision-agent"`
- [x] 5.3 `bun run typecheck`, `bun run build`
- [x] 5.4 Live: reinstall local plugin; `kilo agent list` shows exactly one
      `vision-agent`; switch choice via script → relaunch → new model

## 6. Commits

- [x] 6.1 `plugin: register a single configurable vision-agent subagent`
- [x] 6.2 `scripts: emit fixed vision-agent subagentType`
- [x] 6.3 `skill: delegate to single vision-agent subagent`
- [x] 6.4 `docs: describe single vision-agent and model switching`
