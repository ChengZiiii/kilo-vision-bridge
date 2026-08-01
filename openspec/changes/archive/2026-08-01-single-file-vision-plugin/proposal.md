# Proposal: Single-file vision plugin

## Intent

The plugin currently ships with sibling data files: `subagent-body.md`
(the `vision-agent` prompt template) and `scripts/vision-models.mjs` (a
read-only model listing/validation tool). The user wants the simplest
possible footprint: the subagent body inlined into the plugin, the model
script removed entirely (model choice is a Kilo Code agent-model override;
the user picks vision models themselves), and a naming convention so the
`~/.config/kilo/plugin/` directory stays clean when other plugins are
installed later. Result: this plugin installs as exactly ONE file,
`vision.js`.

## Scope

In scope:

- `plugin.ts`: inline the `vision-agent` body (replace file read + fallback
  with a constant template); `dataDir` detection now keys off `SKILL.md`
  (still needed for skill sync and skills.paths); remove
  `VISION_MODELS_SCRIPT` and the `[vision:model-script]` system-prompt
  injection (the text-only branch injects nothing); drop the
  `[vision:model-script]` mention from `[vision:native]`.
- Delete `scripts/vision-models.mjs` and `subagent-body.md`.
- `package.json`: drop the `models` script and the deleted files from
  `files`; update the description.
- `SKILL.md`: remove the model-script/model-picker flow (Step 4 collapses to
  "the model is configured by the user in Kilo Code; if unset, ask the user
  to configure it"); delegation to `vision-agent` unchanged.
- README: single-file install layout, naming convention for the plugin
  directory (one file per plugin, `vision.js`), no script references.

Out of scope:

- `scripts/install-skill.mjs` (npm postinstall helper) — kept for npm
  package installs; not part of the plugin-directory install.
- RV-1/RV-2 capability routing — unchanged.
- The `vision-agent` registration semantics (no default model, user
  override) — unchanged.

## Approach

1. `bodyTpl` becomes an inline template constant (the current
   `subagent-body.md` content, placeholder-free). The file read and the
   degraded-mode fallback are removed.
2. `dataDir` resolution: `candidateDirs.find(d => existsSync(join(d,
   "SKILL.md"))) ?? bundleDir` — still resolves the npm package root (skill
   sync + skills.paths) while the plugin-directory install falls back to
   the bundle dir harmlessly.
3. System transform: the text-only branch pushes nothing; `[vision:native]`
   no longer references `[vision:model-script]`.
4. Plugin-directory install becomes a single file: copy `dist/index.js` to
   `~/.config/kilo/plugin/vision.js`. README documents the naming
   convention.
