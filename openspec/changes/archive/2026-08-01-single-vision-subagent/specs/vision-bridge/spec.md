# Single Vision Subagent Spec

## REMOVED Requirements

### Requirement: RV-3: Vision subagents are always registered

## ADDED Requirements

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

## MODIFIED Requirements

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
