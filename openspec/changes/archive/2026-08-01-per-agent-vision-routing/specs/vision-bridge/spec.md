# Per-Agent Vision Routing Spec

## ADDED Requirements

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

### Requirement: RV-3: Vision subagents are always registered

**Requirement:** The `config` hook `SHALL` register `vision-*` subagents for
all discovered image-capable models regardless of the top-level `cfg.model`
capability. The previous global skip (`configuredModelVisionCapable` early
return) `SHALL` be removed; `configuredModelVisionCapable` remains as the
shared capability predicate used by RV-1/RV-2 routing.

#### Scenario: Multimodal main model still exposes vision subagents

Given a config with vision-capable top-level `model` and an agent entry that
explicitly configures a text-only model,
when the config hook runs,
then `vision-*` subagents are registered and the text-only agent can delegate
to them.

#### Scenario: Registration set unchanged

Given a config with no top-level model,
when the config hook runs,
then the registered subagent set is identical to the pre-change behavior
(all discovered image-capable models).

### Requirement: RV-4: Skill documents the routing split

**Requirement:** `SKILL.md` `SHALL` state that multimodal models receive
image parts natively and MUST NOT delegate (in addition to the existing
self-gate), and that text-only models receive `[vision:dropped-image]`
markers and delegate. The README `SHALL` describe the per-model routing
behavior.

#### Scenario: Skill guidance matches routing behavior

Given a multimodal orchestrator and a dropped image,
when the skill is consulted,
then it instructs the model to inspect the image natively without spawning a
`vision-*` subagent.

## MODIFIED Requirements

### Requirement: RB-4: Provider/model id matching is case-insensitive

**Requirement:** `plugin.ts` and `scripts/vision-models.mjs` `SHALL` match
provider ids and model ids case-insensitively when intersecting configured
providers with the cached catalog, when applying provider
`whitelist`/`blacklist` filters, when evaluating the
`configuredModelVisionCapable` predicate, and when resolving the persisted
model choice. Output ids (subagent names, persisted choice content) `SHALL`
use the catalog's canonical casing. The case-insensitive matching machinery
(`foldKey` / lowercase key sets) `SHALL` remain intact, and RV-1/RV-2 routing
`SHALL` reuse the same folded lookup for per-message and per-request
capability checks so mixed-case ids keep working.

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
model selection flow, per-model vision routing (multimodal models receive
image parts natively and do not delegate; text-only models receive
`[vision:dropped-image]` markers and delegate to `vision-*` subagents;
`vision-*` subagents are always registered regardless of the top-level
model), the note that Kilo disables npm install/postinstall scripts (skill
sync happens at module load), troubleshooting (`KILO_PURE`,
`--log-level DEBUG`, plugin cache reset), and attribution to the upstream
MIT project.

#### Scenario: Installation method verified

Given the README lists the three loading methods,
then each method is marked with the result of the on-machine test performed
during the port change (works / does not work on Kilo 7.4.17).

### Requirement: RB-8: Plugin loads and registers vision subagents on Kilo 7.4.17

**Requirement:** The built plugin `SHALL` load without errors on Kilo 7.4.17
and register `vision-*` subagents for the machine's configured image-capable
models, visible via `kilo agent list`. Subagents `SHALL` be registered
regardless of whether the top-level config `model` is vision-capable (RV-3);
non-delegation for a multimodal model is enforced by the messages and system
transforms plus the skill self-gate, not by withholding registration.

#### Scenario: Subagents appear

Given the plugin is installed via at least one verified method,
when `kilo agent list` runs,
then it lists `vision-*` agents such as
`vision-minimax-cn-coding-plan-MiniMax-M3`.

#### Scenario: Vision-capable main model skips registration

Given the top-level config `model` is set to a vision-capable
`provider/model` (image input modality in the catalog),
when the plugin's `config` hook runs,
then `vision-*` subagents are still registered (RV-3; so a text-only agent in
the same config can delegate) and the skill remains loadable.
