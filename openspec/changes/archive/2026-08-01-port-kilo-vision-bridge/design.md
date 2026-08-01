# Design

## 1. Case-insensitive id matching (RB-4)

The catalog (`~/.cache/kilo/models.json`) is a models.dev dump with
inconsistent id casing across providers (`minimax-cn-coding-plan/MiniMax-M3`
PascalCase vs `zhipuai-coding-plan/glm-5v-turbo` lowercase). Kilo configs may
reference either casing.

Approach: **fold to lowercase for lookup, keep canonical for output**.

- `fold(id)` = `String(id).toLowerCase()`.
- In both `plugin.ts` and `scripts/vision-models.mjs`, build a folded index of
  the catalog once per run: `Map<foldedProviderID, provider>` and per provider
  `Map<foldedModelID, model>`.
- All lookups go through the folded index:
  - `providerModels(providerID, catalog, config)` — catalog provider lookup.
  - Config override merge (`override.id ?? key` folded, merged onto the
    canonical model entry).
  - `modelAllowed` / `applyProviderModelFilters` — fold both whitelist and
    blacklist entries and the model key.
  - `configuredModelVisionCapable` — fold `splitModel` output before lookup.
  - `readPersistedChoice` — fold the raw choice file line when resolving
    against registered models.
- Outputs keep canonical casing: `VisionModelEntry.provider` /
  `model_id`, subagent names (`vision-minimax-cn-coding-plan-MiniMax-M3`),
  and the persisted choice line. This keeps plugin registration and script
  persistence mutually consistent and stable across casings.

Rationale: zero behavioral cost, kills the whole class of silent-miss bugs,
and keeps the script and plugin in lockstep.

## 2. Status filter alignment (RB-5)

- `plugin.ts` currently skips only `status === "deprecated"`.
- `scripts/vision-models.mjs` currently keeps only `status === "active"`.

Change the **script** to match the plugin: skip only `deprecated`. Every
registered subagent must be selectable/persistable via the script; excluding
beta/alpha models from the script would make them register-but-undelegatable.
The picker already ranks `active` first, so the shortlist quality is
unaffected.

## 3. Skill sync strategy (unchanged, now documented)

Kilo disables install/postinstall scripts for npm plugins (official docs,
verified 2026-08). The ported `plugin.ts` therefore syncs `SKILL.md` to
`~/.config/kilo/skills/vision/SKILL.md` at **module load** (before skill
discovery on the same launch) and additionally pushes the package data dir
onto `config.skills.paths`. `postinstall` in package.json is belt-and-
suspenders. README documents this.

## 4. Config file discovery in the script

`configFileSources` port:

| Upstream (opencode) | Kilo port |
| ------------------- | --------- |
| `config.json`, `opencode.json`, `opencode.jsonc` (global) | `kilo.json`, `kilo.jsonc` (global) |
| `opencode.jsonc`, `opencode.json` (project find-up) | `kilo.jsonc`, `kilo.json` (project find-up) |
| `.opencode` dirs (project + home) | `.kilo` dirs |
| `OPENCODE_*` env vars | `KILO_*` (same names, incl. `KILO_CONFIG_DIR`) |

`stripJsonComments` + `stripTrailingCommas` already handle the real
`kilo.jsonc` (which contains `//` comments). `kilo.jsonc` must be the first
match and must win over `kilo.json` when both exist in the same directory.

## 5. File inventory

| File | Change |
| ---- | ------ |
| `package.json` | peer/dev deps `^7.4.0`, add `engines.opencode` |
| `scripts/vision-models.mjs` | env vars, config discovery, path fns, names, texts, folded matching, status filter |
| `scripts/install-skill.mjs` | `KILO_CONFIG_DIR` + `~/.config/kilo`, log prefix |
| `plugin.ts` | folded matching + `readPersistedChoice` fold (status filter already correct) |
| `SKILL.md` | temp dir name, choice file path, terminology, script path |
| `README.md` | full rewrite (after install verification) |
| `bun.lock` | regenerated via `bun install` |

## 6. Install method verification matrix (RB-7/RB-8)

Three candidate methods on Kilo 7.4.17; record result of each in README:

1. `plugin` array in `~/.config/kilo/kilo.jsonc` (npm name or `file://` path).
2. Copy `dist/index.js` to `~/.config/kilo/plugin/` (auto-load dir).
3. `kilo plugin kilo-vision-bridge [-g]` (npm install + config patch).

Verification: `kilo agent list` shows `vision-*` subagents; no load errors in
`kilo --print-logs --log-level DEBUG` output.

## 7. Commit sequence

Per user convention (English imperative + subsystem prefix):

1. `chore: fix @kilocode/plugin peer deps and engines range`
2. `scripts: port vision-models.mjs to kilo paths`
3. `scripts: port install-skill.mjs to kilo paths`
4. `plugin: match provider/model ids case-insensitively`
5. `skill: update vision SKILL.md for kilo`
6. `docs: rewrite README for kilo-vision-bridge`
7. `chore: regenerate bun.lock`
8. `test: verify build, discovery script, and plugin loading` (verification
   findings reported, not necessarily a commit)
