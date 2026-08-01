# Single-File Vision Plugin Spec

## REMOVED Requirements

### Requirement: RB-2: Model discovery script is kilo-ized

## MODIFIED Requirements

### Requirement: RB-4: Provider/model id matching is case-insensitive

**Requirement:** `plugin.ts` `SHALL` match provider ids and model ids
case-insensitively when intersecting configured providers with the cached
catalog, when applying provider `whitelist`/`blacklist` filters, when
evaluating the `configuredModelVisionCapable` predicate, and when resolving
a user-provided model id (the Kilo Code override value). The
case-insensitive matching machinery (`foldKey` / lowercase key sets) `SHALL`
remain intact, and RV-1/RV-2 routing `SHALL` reuse the same folded lookup
for per-message and per-request capability checks so mixed-case ids keep
working.

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

### Requirement: RB-6: SKILL.md is kilo-ized

**Requirement:** `SKILL.md` `SHALL` use Kilo terminology throughout, name
`kilo-vision-bridge` as the temporary image subdirectory, and `SHALL NOT`
reference any model discovery script or picker flow — the `vision-agent`
model is configured by the user through the Kilo Code agent model override.

#### Scenario: Skill docs match plugin behavior

Given the plugin materializes dropped images under
`<system-temp>/kilo-vision-bridge/`,
when the skill describes Source D,
then it documents `[vision:dropped-image]` with `path` under
`kilo-vision-bridge`.

### Requirement: RB-7: README documents kilo-vision-bridge

**Requirement:** `README.md` `SHALL` describe the plugin's purpose, the
empirically verified installation methods for Kilo 7.4.17 (config `plugin`
array, the single-file `~/.config/kilo/plugin/vision.js` directory layout
with a per-plugin-file naming convention, `kilo plugin <pkg>` command), the
single `vision-agent` subagent registered WITHOUT a default model, the Kilo
Code agent-model override as the way to set its vision model, the disable
option (`disable: true` / Kilo Code agent disable), per-model vision routing
(multimodal models receive image parts natively and do not delegate;
text-only models receive `[vision:dropped-image]` markers and delegate to
`vision-agent`), the note that Kilo disables npm install/postinstall scripts
(skill sync happens at module load), troubleshooting (`KILO_PURE`,
`--log-level DEBUG`, plugin cache reset), and attribution to the upstream
MIT project. The README `SHALL NOT` reference a model listing script.

#### Scenario: Installation method verified

Given the README lists the three loading methods,
then each method is marked with the result of the on-machine test performed
during the port change (works / does not work on Kilo 7.4.17).

### Requirement: RV-4: Skill documents the routing split

**Requirement:** `SKILL.md` `SHALL` state that multimodal models receive
image parts natively and MUST NOT delegate (in addition to the existing
self-gate), that text-only models receive `[vision:dropped-image]` markers
and delegate, and that delegation `SHALL` target the single `vision-agent`
subagent whose model is configured by the user through the Kilo Code agent
model override (not by the plugin, and with no model discovery script).
It `SHALL` state that disabling `vision-agent` in Kilo Code disables
delegation. The README `SHALL` describe the per-model routing behavior.

#### Scenario: Skill guidance matches routing behavior

Given a multimodal orchestrator and a dropped image,
when the skill is consulted,
then it instructs the model to inspect the image natively without spawning a
`vision-*` subagent.
