# Proposal: Complete the kilo port of kilo-vision-bridge

## Intent

`kilo-vision-bridge` is a port of `wezzard/opencode-vision` (MIT) that gives
text-only Kilo orchestrator models vision by delegating visual tasks to
dynamically registered `vision-<provider>-<model>` subagents backed by
image-capable models discovered from Kilo's configured providers and cached
model catalog.

`plugin.ts` was already ported (paths, env vars, skill sync target, hooks
verified against `@kilocode/plugin@7.4.5` SDK types). This change completes the
port and fixes two latent issues found during cross-validation:

1. `package.json` still declares `@kilocode/plugin` `^1.4.7` (copied from
   upstream) while the real SDK is 7.x.
2. Provider/model id matching is case-sensitive while the models.dev catalog
   Kilo ships is internally inconsistent (`minimax-cn-coding-plan/MiniMax-M3`
   vs `zhipuai-coding-plan/glm-5v-turbo`), so discovery, the
   `configuredModelVisionCapable` gate, and the persisted-choice lookup can
   silently miss configured models.

## Scope

In scope:

- Port `scripts/vision-models.mjs` (env vars, config file discovery, path
  functions, names, help/warning text) and `scripts/install-skill.mjs`.
- Port `SKILL.md` (paths, temp dir name, terminology).
- Rewrite `README.md` as kilo-vision-bridge documentation, including the
  empirically verified plugin loading method for Kilo 7.4.17.
- Fix `package.json` peer/dev dependencies and add an `engines.opencode`
  compatibility range.
- Add case-insensitive provider/model id matching in `plugin.ts` and
  `scripts/vision-models.mjs`.
- Align the model status filter between `plugin.ts` and the script.
- Regenerate `bun.lock`.
- Verify: build, model discovery script on the real machine, plugin loading
  via all three documented methods, `kilo agent list` showing `vision-*`
  subagents, and the vision-capable-main-model gate.

Out of scope:

- Upstream behavior changes beyond the port (message transform format,
  skill body, picker algorithm, temp dir layout).
- Publishing to npm (separate step, requires user confirmation).
- Changes to `subagent-body.md` and `tsconfig.json` (verified clean already).

## Approach

1. Manifest fixes first (deps + engines).
2. Port the two scripts and SKILL.md, applying the case-insensitive matching
   and status-filter alignment consistently across `plugin.ts` and the script.
3. Rewrite README after install-method verification is complete.
4. Regenerate lockfile; build; run the discovery script; load the plugin via
   all three documented methods and record which work on Kilo 7.4.17.
5. One commit per work unit, English imperative + subsystem prefix.
