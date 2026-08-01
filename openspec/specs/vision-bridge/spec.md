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
`configuredModelVisionCapable` predicate, and when resolving the persisted
model choice. Persisted choice content `SHALL` use the catalog's canonical
casing. The case-insensitive matching machinery (`foldKey` / lowercase key
sets) `SHALL` remain intact, and RV-1/RV-2 routing `SHALL` reuse the same
folded lookup for per-message and per-request capability checks so mixed-case
ids keep working.

#### Scenario: Config id casing differs from catalog id

Given a configured provider id `Minimax-Cn-Coding-Plan` and a catalog
provider `minimax-cn-coding-plan` whose model entry is `MiniMax-M3`,
when discovery and choice resolution run,
then the model is discovered, the persisted choice resolves to the canonical
`minimax-cn-coding-plan/MiniMax-M3`, and `vision-agent` is registered with
that canonical id.

#### Scenario: Gate with mixed-case model string

Given `cfg.model` is `minimax-cn-coding-plan/minimax-m3` and the catalog
stores `MiniMax-M3` with image input modality,
when `configuredModelVisionCapable` runs (used by the config-time capability
state and RV-1/RV-2 routing),
then it returns true, so a request handled by that model is treated as
vision-capable.

#### Scenario: Persisted choice with mixed-case id

Given the choice file contains `minimax-cn-coding-plan/minimax-m3` and the
registered catalog id is `MiniMax-M3`,
when the plugin reads the persisted choice,
then the choice is recognized and `[vision:model-choice]` is appended to the
system prompt with the canonical id.

#### Scenario: Mixed-case model id routes correctly

Given `input.model` reports `minimax-cn-coding-plan/minimax-m3` while the
registered key is `minimax-cn-coding-plan/MiniMax-M3`,
when the system transform runs,
then the model is recognized as vision-capable and receives the native-vision
instruction.

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
single `vision-agent` subagent and its model-switching flow (update
`vision-model-image.txt` via the script; takes effect on the next launch or
VS Code config auto-refresh), per-model vision routing (multimodal models
receive image parts natively and do not delegate; text-only models receive
`[vision:dropped-image]` markers and delegate to `vision-agent`), the note
that Kilo disables npm install/postinstall scripts (skill sync happens at
module load), troubleshooting (`KILO_PURE`, `--log-level DEBUG`, plugin cache
reset), and attribution to the upstream MIT project.

#### Scenario: Installation method verified

Given the README lists the three loading methods,
then each method is marked with the result of the on-machine test performed
during the port change (works / does not work on Kilo 7.4.17).

### Requirement: RB-8: Plugin loads and registers vision subagents on Kilo 7.4.17

**Requirement:** The built plugin `SHALL` load without errors on Kilo 7.4.17.
When a persisted vision model choice exists, it `SHALL` register the single
`vision-agent` subagent with that model, visible via `kilo agent list`; when
no choice exists, it `SHALL NOT` register it. Exactly one `vision-*`
subagent is ever registered.

#### Scenario: Subagents appear

Given a persisted vision model choice and the plugin installed via at least
one verified method,
when `kilo agent list` runs,
then it lists exactly one `vision-*` subagent, `vision-agent`, configured
with the chosen model.

#### Scenario: Vision-capable main model still registers subagents

Given the top-level config `model` is set to a vision-capable
`provider/model` and a persisted choice exists,
when the plugin's `config` hook runs,
then `vision-agent` is still registered (so a text-only agent in the same
config can delegate) and the skill remains loadable.

### Requirement: RV-1: Image parts are rewritten only for text-only models

**Requirement:** The `experimental.chat.messages.transform` hook `SHALL`
rewrite image `FilePart`s into `[vision:dropped-image]` text markers only for
user messages whose handling model is NOT vision-capable. For user messages
whose handling model IS vision-capable, image parts `SHALL` pass through
unchanged so the multimodal model receives them natively. Capability `SHALL`
be resolved per message in this order: (1) the message's `info.model`
(`providerID`/`modelID`) looked up case-insensitively against the registered
vision model key set; (2) the message's `info.agent` looked up in the
agent→capability map built at config time; (3) the top-level config `model`
capability as final fallback.

#### Scenario: Multimodal agent keeps native image input

Given a session on an agent whose model is vision-capable (e.g.
`minimax-cn-coding-plan/MiniMax-M3`) and a user message containing an image
FilePart,
when the messages transform runs,
then the FilePart is left untouched (no `[vision:dropped-image]` marker, no
temp file written).

#### Scenario: Text-only agent gets the marker

Given a session on an agent whose model is text-only (e.g.
`opencode-go/deepseek-v4-flash`) and a user message containing an image
FilePart,
when the messages transform runs,
then the image bytes are materialized under the plugin temp dir and the part
is rewritten to `[vision:dropped-image]` with the resulting path.

#### Scenario: Capability resolved from message model before agent name

Given a message whose `info.model` is a vision model while `info.agent` maps
to a text-only agent,
when the transform runs,
then the image part is NOT rewritten (message model wins over agent map).

### Requirement: RV-2: System prompt instructions are model-appropriate

**Requirement:** The `experimental.chat.system.transform` hook `SHALL`
inspect `input.model` and push model-appropriate instructions: for a
vision-capable model, a single instruction stating the model sees images
natively and MUST NOT use the vision skill or delegate visual tasks; for a
text-only model, the existing `[vision:model-script]` and
`[vision:model-choice]` instructions. If `input.model` is unavailable, the
text-only instructions `SHALL` be used.

#### Scenario: Multimodal model instructed to use native vision

Given a request whose `input.model` is vision-capable,
when the system transform runs,
then `output.system` contains a native-vision instruction and does not
contain `[vision:model-script]` or `[vision:model-choice]`.

#### Scenario: Text-only model keeps delegation instructions

Given a request whose `input.model` is text-only,
when the system transform runs,
then `output.system` contains `[vision:model-script]` (and
`[vision:model-choice]` when a persisted choice exists) and no native-vision
instruction.

### Requirement: RV-4: Skill documents the routing split

**Requirement:** `SKILL.md` `SHALL` state that multimodal models receive
image parts natively and MUST NOT delegate (in addition to the existing
self-gate), that text-only models receive `[vision:dropped-image]` markers
and delegate, and that delegation `SHALL` target the single `vision-agent`
subagent. It `SHALL` instruct the orchestrator to switch the vision model via
`node scripts/vision-models.mjs --model <provider/model>` and note that the
change takes effect on the next launch (the VS Code extension auto-refreshes
on save). The README `SHALL` describe the per-model routing behavior.

#### Scenario: Skill guidance matches routing behavior

Given a multimodal orchestrator and a dropped image,
when the skill is consulted,
then it instructs the model to inspect the image natively without spawning a
`vision-*` subagent.

### Requirement: RV-5: A single configurable vision subagent is registered

**Requirement:** The `config` hook `SHALL` register exactly one subagent named
`vision-agent` whose `model` is the persisted vision model choice
(`~/.config/kilo/vision-model-image.txt`), resolved case-insensitively to the
canonical catalog id. When no persisted choice exists, the hook `SHALL NOT`
register `vision-agent`. Registration `SHALL` be re-evaluated on every launch
(the config hook runs per startup), so model switches take effect on the next
launch or, in the VS Code extension, on config auto-refresh.

#### Scenario: Persisted choice registers the single subagent

Given the choice file contains `minimax-cn-coding-plan/MiniMax-M3`,
when the config hook runs,
then `cfg.agent["vision-agent"].model` is
`minimax-cn-coding-plan/MiniMax-M3` and no other `vision-*` subagents exist.

#### Scenario: No choice means no registration

Given no persisted vision model choice,
when the config hook runs,
then no `vision-agent` is registered.

#### Scenario: Mixed-case choice resolves canonically

Given the choice file contains `MINIMAX-CN-CODING-PLAN/minimax-m3` while the
catalog stores `MiniMax-M3`,
when the config hook runs,
then `vision-agent` is registered with the canonical
`minimax-cn-coding-plan/MiniMax-M3`.

#### Scenario: Model switch applies on next launch

Given the choice file is updated from model A to model B via
`vision-models.mjs --model <provider/model>`,
when kilo (re)starts or the VS Code config auto-refreshes,
then `vision-agent` is registered with model B.

