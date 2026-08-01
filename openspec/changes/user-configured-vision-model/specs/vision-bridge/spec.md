# User-Configured Vision Model Spec

## REMOVED Requirements

### Requirement: RV-5: A single configurable vision subagent is registered

## ADDED Requirements

### Requirement: RV-6: vision-agent is registered without a default model

**Requirement:** The `config` hook `SHALL` register the single `vision-agent`
subagent on every launch WITHOUT setting its `model` (default = unset). The
vision model `SHALL` be specified entirely by the user through the Kilo Code
agent model override (or any user config on `agent["vision-agent"].model`);
the plugin `SHALL NOT` write the `model` field. The plugin `SHALL NOT`
persist, read, or inject any model-choice state. A user-set
`disable: true` on `agent["vision-agent"]` `SHALL` remain effective (the
hook `SHALL NOT` overwrite it), so Kilo Code's built-in agent disable turns
delegation off.

#### Scenario: vision-agent registers with no model

Given the plugin's config hook runs,
when `cfg.agent["vision-agent"]` is inspected,
then it exists with mode `subagent` and NO `model` field set by the plugin.

#### Scenario: User override supplies the model

Given the user overrides `agent["vision-agent"].model` to
`minimax-cn-coding-plan/MiniMax-M3` in Kilo Code,
when the config hook runs,
then the override is preserved (the plugin does not touch the model field)
and visual delegations use that model.

#### Scenario: Disabled agent stays disabled

Given the user sets `agent["vision-agent"].disable = true` in Kilo Code,
when the config hook runs and `kilo agent list` executes,
then `vision-agent` does not appear (Kilo skips disabled agents) and
delegation to it fails/refuses.

#### Scenario: No persisted state

Given the plugin is installed,
when the config hook runs and the system transform executes,
then no `vision-model-image.txt` file is read or written and no
`[vision:model-choice]` instruction is injected.

## MODIFIED Requirements

### Requirement: RB-2: Model discovery script is kilo-ized

**Requirement:** `scripts/vision-models.mjs` `SHALL` use Kilo paths and
environment variables: `KILO_TEST_HOME`, `KILO_CONFIG_DIR`, `KILO_DATA_DIR`,
`KILO_MODELS_PATH`, `KILO_MODELS_URL`, `KILO_AUTH_CONTENT`, `KILO_CWD`,
`KILO_WORKTREE`, `KILO_CONFIG`, `KILO_DISABLE_PROJECT_CONFIG`,
`KILO_CONFIG_CONTENT`. It `SHALL` discover config files named
`kilo.json`/`kilo.jsonc` (global dir, project dirs, and `~/.kilo`), scanning
`kilo.jsonc` with JSONC comment/trailing-comma stripping. The script `SHALL`
be read-only: it lists image-capable models and `SHALL NOT` persist any
choice (no `--model` write, no choice file). Help text and warning messages
`SHALL` say "Kilo" and reference `~/.config/kilo` paths.

#### Scenario: Global config discovery on the reference machine

Given a `kilo.jsonc` at `~/.config/kilo` with comments and provider entries,
when `node scripts/vision-models.mjs` runs with no flags,
then it parses `kilo.jsonc`, intersects configured providers with
`~/.cache/kilo/models.json`, and outputs `ok: true` with a `models[]` list of
image-capable models (including `minimax-cn-coding-plan/MiniMax-M3`).

#### Scenario: Persisted selection

Given the script lists an image-capable model,
when run with `--model <provider/model>` or any flag,
then it validates the id, does NOT write any file, and the output contains no
`persistedChoice` state — the script is read-only.

#### Scenario: Unknown model rejected

Given `--model <provider/model>` does not match any discovered image-capable
model,
then the script exits non-zero with `ok: false` and writes nothing.

### Requirement: RB-4: Provider/model id matching is case-insensitive

**Requirement:** `plugin.ts` and `scripts/vision-models.mjs` `SHALL` match
provider ids and model ids case-insensitively when intersecting configured
providers with the cached catalog, when applying provider
`whitelist`/`blacklist` filters, when evaluating the
`configuredModelVisionCapable` predicate, and when resolving a user-provided
model id (the Kilo Code override value). The case-insensitive matching
machinery (`foldKey` / lowercase key sets) `SHALL` remain intact, and
RV-1/RV-2 routing `SHALL` reuse the same folded lookup for per-message and
per-request capability checks so mixed-case ids keep working.

#### Scenario: Config id casing differs from catalog id

Given a configured provider id `Minimax-Cn-Coding-Plan` and a catalog
provider `minimax-cn-coding-plan` whose model entry is `MiniMax-M3`,
when discovery and override resolution run,
then the model is discovered and a user override of
`minimax-cn-coding-plan/MiniMax-M3` resolves to that catalog entry
case-insensitively.

#### Scenario: Gate with mixed-case model string

Given `cfg.model` is `minimax-cn-coding-plan/minimax-m3` and the catalog
stores `MiniMax-M3` with image input modality,
when `configuredModelVisionCapable` runs (used by the config-time capability
state and RV-1/RV-2 routing),
then it returns true, so a request handled by that model is treated as
vision-capable.

#### Scenario: Persisted choice with mixed-case id

Given the user overrides `agent["vision-agent"].model` with
`minimax-cn-coding-plan/minimax-m3` while the catalog id is `MiniMax-M3`,
when the plugin resolves the override,
then the model is recognized as vision-capable (folded match) and image
delegations target a model that can see images.

#### Scenario: Mixed-case model id routes correctly

Given `input.model` reports `minimax-cn-coding-plan/minimax-m3` while the
registered key is `minimax-cn-coding-plan/MiniMax-M3`,
when the system transform runs,
then the model is recognized as vision-capable and receives the native-vision
instruction.

### Requirement: RB-7: README documents kilo-vision-bridge

**Requirement:** `README.md` `SHALL` describe the plugin's purpose, the
empirically verified installation methods for Kilo 7.4.17 (config `plugin`
array, `~/.config/kilo/plugin/` directory, `kilo plugin <pkg>` command), the
single `vision-agent` subagent registered WITHOUT a default model, the
Kilo Code agent-model override as the way to set its vision model, the
disable option (`disable: true` / Kilo Code agent disable), the read-only
`vision-models.mjs` listing script, per-model vision routing (multimodal
models receive image parts natively and do not delegate; text-only models
receive `[vision:dropped-image]` markers and delegate to `vision-agent`),
the note that Kilo disables npm install/postinstall scripts (skill sync
happens at module load), troubleshooting (`KILO_PURE`, `--log-level DEBUG`,
plugin cache reset), and attribution to the upstream MIT project.

#### Scenario: Installation method verified

Given the README lists the three loading methods,
then each method is marked with the result of the on-machine test performed
during the port change (works / does not work on Kilo 7.4.17).

### Requirement: RB-8: Plugin loads and registers vision subagents on Kilo 7.4.17

**Requirement:** The built plugin `SHALL` load without errors on Kilo 7.4.17
and register the single `vision-agent` subagent (no `model` set), visible
via `kilo agent list`. Exactly one `vision-*` subagent is ever registered.
A user `disable: true` on `agent["vision-agent"]` `SHALL` hide it.

#### Scenario: Subagents appear

Given the plugin is installed via at least one verified method,
when `kilo agent list` runs,
then it lists exactly one `vision-*` subagent, `vision-agent`, with no
plugin-assigned model.

#### Scenario: Vision-capable main model still registers subagents

Given the top-level config `model` is set to a vision-capable
`provider/model`,
when the plugin's `config` hook runs,
then `vision-agent` is still registered (so a text-only agent in the same
config can delegate) and the skill remains loadable.

### Requirement: RV-4: Skill documents the routing split

**Requirement:** `SKILL.md` `SHALL` state that multimodal models receive
image parts natively and MUST NOT delegate (in addition to the existing
self-gate), that text-only models receive `[vision:dropped-image]` markers
and delegate, and that delegation `SHALL` target the single `vision-agent`
subagent whose model is configured by the user through the Kilo Code agent
model override (not by the plugin). It `SHALL` mention the read-only
`vision-models.mjs` listing script and that disabling `vision-agent` in Kilo
Code disables delegation. The README `SHALL` describe the per-model routing
behavior.

#### Scenario: Skill guidance matches routing behavior

Given a multimodal orchestrator and a dropped image,
when the skill is consulted,
then it instructs the model to inspect the image natively without spawning a
`vision-*` subagent.
