# vision-bridge Specification

## Purpose
TBD - created by archiving change port-kilo-vision-bridge. Update Purpose after archive.
## Requirements
### Requirement: RB-1: Package manifest targets the Kilo plugin SDK

**Requirement:** The package `SHALL` declare `@kilocode/plugin` `^7.4.0` in
both `peerDependencies` and `devDependencies`. The package `SHALL` declare an
`engines.opencode` range of `^7.0.0` so incompatible Kilo CLI versions skip
loading with a warning.

#### Scenario: Install resolves the 7.x SDK

Given the package manifest declares `@kilocode/plugin` `^7.4.0` in
`peerDependencies` and `devDependencies`,
when `bun install` runs,
then `bun.lock` is regenerated and contains `@kilocode/plugin` 7.x
and the build (`bun run build`) produces `dist/index.js`.

#### Scenario: CLI compatibility range

Given `package.json` declares `"engines": { "opencode": "^7.0.0" }`,
when a Kilo CLI older than 7.0.0 loads the plugin,
then the plugin is skipped with a warning instead of failing the load.

### Requirement: RB-2: Model discovery script is kilo-ized

**Requirement:** `scripts/vision-models.mjs` `SHALL` use Kilo paths and
environment variables: `KILO_TEST_HOME`, `KILO_CONFIG_DIR`, `KILO_DATA_DIR`,
`KILO_MODELS_PATH`, `KILO_MODELS_URL`, `KILO_AUTH_CONTENT`, `KILO_CWD`,
`KILO_WORKTREE`, `KILO_CONFIG`, `KILO_DISABLE_PROJECT_CONFIG`,
`KILO_CONFIG_CONTENT`. It `SHALL` discover config files named
`kilo.json`/`kilo.jsonc` (global dir, project dirs, and `~/.kilo`), scanning
`kilo.jsonc` with JSONC comment/trailing-comma stripping. Help text and
warning messages `SHALL` say "Kilo" and reference `~/.config/kilo` paths.

#### Scenario: Global config discovery on the reference machine

Given a `kilo.jsonc` at `~/.config/kilo` with comments and provider entries,
when `node scripts/vision-models.mjs` runs with no flags,
then it parses `kilo.jsonc`, intersects configured providers with
`~/.cache/kilo/models.json`, and outputs `ok: true` with a `models[]` list of
image-capable models (including `minimax-cn-coding-plan/MiniMax-M3`).

#### Scenario: Persisted selection

Given the script lists an image-capable model,
when run with `--model <provider/model>`,
then it validates the id, writes `<provider/model>` to
`~/.config/kilo/vision-model-image.txt`, and outputs `saved: true`.

#### Scenario: Unknown model rejected

Given `--model <provider/model>` does not match any discovered image-capable
model,
then the script exits non-zero with `ok: false` and does not overwrite an
existing persisted choice.

### Requirement: RB-3: Skill installer targets the kilo config dir

**Requirement:** `scripts/install-skill.mjs` `SHALL` install the skill to
`~/.config/kilo/skills/vision/SKILL.md`, honoring `KILO_CONFIG_DIR` and
`XDG_CONFIG_HOME`. Output `SHALL` identify the package as `kilo-vision-bridge`.

#### Scenario: Install to default location

Given `KILO_CONFIG_DIR` is unset and `XDG_CONFIG_HOME` is unset,
when the script runs,
then `SKILL.md` is copied to
`<home>/.config/kilo/skills/vision/SKILL.md`.

### Requirement: RB-4: Provider/model id matching is case-insensitive

**Requirement:** `plugin.ts` and `scripts/vision-models.mjs` `SHALL` match
provider ids and model ids case-insensitively when intersecting configured
providers with the cached catalog, when applying provider
`whitelist`/`blacklist` filters, when evaluating the
`configuredModelVisionCapable` gate, and when resolving the persisted model
choice. Output ids (subagent names, persisted choice content) `SHALL` use the
catalog's canonical casing.

#### Scenario: Config id casing differs from catalog id

Given a configured provider id `Minimax-Cn-Coding-Plan` and a catalog
provider `minimax-cn-coding-plan` whose model entry is `MiniMax-M3`,
when discovery runs,
then the model is discovered, the subagent is named
`vision-minimax-cn-coding-plan-MiniMax-M3`, and the choice file contains the
canonical `minimax-cn-coding-plan/MiniMax-M3`.

#### Scenario: Gate with mixed-case model string

Given `cfg.model` is `minimax-cn-coding-plan/minimax-m3` and the catalog
stores `MiniMax-M3` with image input modality,
when `configuredModelVisionCapable` runs,
then it returns true (subagents are not registered).

#### Scenario: Persisted choice with mixed-case id

Given the choice file contains `minimax-cn-coding-plan/minimax-m3` and the
registered catalog id is `MiniMax-M3`,
when the plugin reads the persisted choice,
then the choice is recognized and `[vision:model-choice]` is appended to the
system prompt with the canonical id.

### Requirement: RB-5: Status filter is consistent across plugin and script

**Requirement:** Both `plugin.ts` and `scripts/vision-models.mjs` `SHALL` skip
models whose `status` is `"deprecated"` and include models with any other
status (including `"active"`, `"beta"`, `"alpha"`, or unset).

#### Scenario: Beta model is selectable

Given a configured model with `status: "beta"` and image input modality,
when discovery runs in both the plugin and the script,
then the model is registered as a subagent and listed by the script, and
`--model <provider/model>` persists it.

### Requirement: RB-6: SKILL.md is kilo-ized

**Requirement:** `SKILL.md` `SHALL` reference `~/.config/kilo/vision-model-image.txt`
as the persisted choice file, `kilo-vision-bridge` as the temporary image
subdirectory, and Kilo terminology throughout. It `SHALL` instruct the
orchestrator to run `node <package>/scripts/vision-models.mjs`.

#### Scenario: Skill docs match plugin behavior

Given the plugin materializes dropped images under
`<system-temp>/kilo-vision-bridge/`,
when the skill describes Source D,
then it documents `[vision:dropped-image]` with `path` under
`kilo-vision-bridge`.

### Requirement: RB-7: README documents kilo-vision-bridge

**Requirement:** `README.md` `SHALL` describe the plugin's purpose, the
empirically verified installation methods for Kilo 7.4.17 (config `plugin`
array, `~/.config/kilo/plugin/` directory, `kilo plugin <pkg>` command), the
model selection flow, the vision-capable-main-model bypass, the note that
Kilo disables npm install/postinstall scripts (skill sync happens at module
load), troubleshooting (`KILO_PURE`, `--log-level DEBUG`, plugin cache
reset), and attribution to the upstream MIT project.

#### Scenario: Installation method verified

Given the README lists the three loading methods,
then each method is marked with the result of the on-machine test performed
during this change (works / does not work on Kilo 7.4.17).

### Requirement: RB-8: Plugin loads and registers vision subagents on Kilo 7.4.17

**Requirement:** The built plugin `SHALL` load without errors on Kilo 7.4.17
and register `vision-*` subagents for the machine's configured image-capable
models, visible via `kilo agent list`.

#### Scenario: Subagents appear

Given the plugin is installed via at least one verified method,
when `kilo agent list` runs,
then it lists `vision-*` agents such as
`vision-minimax-cn-coding-plan-MiniMax-M3`.

#### Scenario: Vision-capable main model skips registration

Given the top-level config `model` is set to a vision-capable
`provider/model` (image input modality in the catalog),
when the plugin's `config` hook runs,
then no `vision-*` subagents are registered and the skill remains loadable.

