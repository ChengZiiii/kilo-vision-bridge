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
array, `~/.config/kilo/plugin/` directory, `kilo plugin <pkg>` command), the
single `vision-agent` subagent registered WITHOUT a default model, the Kilo
Code agent-model override as the single vision model knob for both the
`vision_analyze` tool and the subagent, the auto-allowed `vision_analyze`
permission (explicit user `deny` wins), the tool-first / subagent-fallback
routing, the disable option (`disable: true` disables both paths), per-model
vision routing (multimodal models receive image parts natively and do not
delegate; text-only models receive `[vision:dropped-image]` markers and
delegate), the note that subagent delegation no longer requires
`subagent_depth` or `permission.task` config when the tool path is used,
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
image parts natively and MUST NOT delegate, that text-only models receive
`[vision:dropped-image]` markers and delegate, and that delegation `SHALL`
target the `vision_analyze` tool first with the `vision-agent` subagent as
fallback on tool unavailability or provider/protocol/HTTP errors. The
vision model for both paths `SHALL` be configured by the user through the
Kilo Code agent model override on `vision-agent` (not by the plugin). It
`SHALL` state that disabling `vision-agent` in Kilo Code disables both
paths.

#### Scenario: Skill guidance matches routing behavior

Given a multimodal orchestrator and a dropped image,
when the skill is consulted,
then it instructs the model to inspect the image natively without calling
`vision_analyze` or spawning a `vision-*` subagent.

#### Scenario: Skill guidance matches tool-first behavior

Given a text-only orchestrator and a dropped image,
when the skill is consulted,
then it instructs calling `vision_analyze` and mentions the
`vision-agent` subagent fallback.

### Requirement: RV-6: vision-agent is registered without a default model

**Requirement:** The `config` hook `SHALL` register the single `vision-agent`
subagent on every launch WITHOUT setting its `model` (default = unset). The
vision model `SHALL` be specified entirely by the user through the Kilo Code
agent model override (or any user config on `agent["vision-agent"].model`);
the plugin `SHALL NOT` write the `model` field. The override `SHALL` serve
both the `vision_analyze` tool (VT-2) and the subagent fallback. The plugin
`SHALL NOT` persist, read, or inject any model-choice state. A user-set
`disable: true` on `agent["vision-agent"]` `SHALL` remain effective and
`SHALL` disable both the tool (VT-2) and the subagent.

#### Scenario: vision-agent registers with no model

Given the plugin's config hook runs,
when `cfg.agent["vision-agent"]` is inspected,
then it exists with mode `subagent` and NO `model` field set by the plugin.

#### Scenario: User override supplies the model

Given the user overrides `agent["vision-agent"].model` to
`minimax-cn-coding-plan/MiniMax-M3` in Kilo Code,
when the config hook runs,
then the override is preserved (the plugin does not touch the model field)
and both the `vision_analyze` tool (VT-2) and visual subagent delegations
use that model.

#### Scenario: Disabled agent stays disabled

Given the user sets `agent["vision-agent"].disable = true` in Kilo Code,
when the config hook runs and `kilo agent list` executes,
then `vision-agent` does not appear (Kilo skips disabled agents) and
delegation to it fails/refuses.

#### Scenario: Disabled agent disables both paths

Given the user sets `agent["vision-agent"].disable = true` in Kilo Code,
when the config hook runs and the tool registry is inspected,
then `vision-agent` does not appear in `kilo agent list` and
`vision_analyze` is not registered.

#### Scenario: No persisted state

Given the plugin is installed,
when the config hook runs and the system transform executes,
then no `vision-model-image.txt` file is read or written and no
`[vision:model-choice]` instruction is injected.

### Requirement: VT-1: vision_analyze tool is registered natively

**Requirement:** The plugin `SHALL` register a native tool named
`vision_analyze` through the `@kilocode/plugin` `tool` hook on every launch
(unless disabled per VT-2). The tool's arguments `SHALL` be: `images` — an
array of `{id: string, path: string}` entries (short contract ids plus local
image paths), `question` — the exact visual question, `response_template` —
a JSON string defining the required response shape, and optional
`response_rules` — task-specific response constraints. The tool `SHALL`
read the listed image files, submit them together with the question to the
configured vision model, and return exactly one JSON object matching
`response_template`.

#### Scenario: Tool is listed

Given the plugin is loaded with `agent["vision-agent"].model` set,
when the tool registry is inspected,
then `vision_analyze` is present with the declared arguments.

#### Scenario: Tool returns template-shaped JSON

Given two local image paths and a `response_template` with keys
`isCentered` and `evidence`,
when `execute` runs against a vision model that returns matching JSON,
then the tool output is that JSON text and the images were included in the
model request as base64 data URLs with mime inferred from the paths.

#### Scenario: Missing image file

Given an `images` entry whose path does not exist,
when `execute` runs,
then the tool returns an error naming the path and no model call is made.

### Requirement: VT-2: Tool model comes from the existing vision-agent override

**Requirement:** The `vision_analyze` tool's model `SHALL` be resolved from
the user's `agent["vision-agent"].model` override (same single knob as the
subagent path); the plugin `SHALL NOT` write that field and `SHALL NOT`
invent or default a model. If the override is unset, or resolves to a model
that is not image-capable per the catalog, `execute` `SHALL` return an error
that names the fix (`agent["vision-agent"].model`) instead of calling any
model. If the user sets `agent["vision-agent"].disable = true`, the plugin
`SHALL NOT` register the tool.

#### Scenario: No override produces a fixable error

Given `agent["vision-agent"].model` is unset,
when `vision_analyze` is invoked,
then the tool returns an error instructing the user to set the override and
no HTTP request is made.

#### Scenario: Disabled agent removes the tool

Given `agent["vision-agent"].disable = true`,
when the tool registry is inspected,
then `vision_analyze` is absent while `vision-agent` remains hidden as
today.

#### Scenario: Override preserved by the plugin

Given the user sets `agent["vision-agent"].model` to
`minimax-cn-coding-plan/MiniMax-M3`,
when the config hook runs,
then the field is unchanged and tool calls target that model id.

### Requirement: VT-3: vision_analyze permission is auto-allowed

**Requirement:** The plugin `SHALL` register a `permission.ask` hook that
upgrades `ask` to `allow` for `vision_analyze` permission requests. An
explicit user-configured `deny` (e.g. `permission.vision_analyze = "deny"`)
`SHALL` take precedence and is never overwritten by the hook.

#### Scenario: Subagent session calls the tool without prompting

Given a subagent session (depth >= 1) whose ruleset has no
`vision_analyze` rule,
when the agent calls `vision_analyze`,
then the call proceeds without a permission prompt.

#### Scenario: Explicit deny wins

Given the user configures `permission.vision_analyze = "deny"`,
when an agent calls `vision_analyze`,
then the call is denied (the hook does not override the deny).

### Requirement: VT-4: Skill routes tool-first with subagent fallback

**Requirement:** `SKILL.md` `SHALL` instruct text-only orchestrators to
delegate visual tasks by calling the `vision_analyze` tool first. It `SHALL`
instruct falling back to spawning the `vision-agent` subagent (existing
delegation template) only when (a) the tool is not present in the current
session's toolset, or (b) the tool call fails with a provider, protocol, or
HTTP error. A "model not configured" error `SHALL NOT` trigger the fallback;
the orchestrator `SHALL` surface it and direct the user to set
`agent["vision-agent"].model`. The skill `SHALL` keep the existing
detect/extract/parse steps and the native-vision gate (multimodal models
MUST NOT delegate).

#### Scenario: Tool present routes to the tool

Given a text-only session whose toolset contains `vision_analyze`,
when the skill's delegation step runs,
then it calls `vision_analyze` with `images`, `question`,
`response_template`, and `response_rules`.

#### Scenario: Provider error falls back to the subagent

Given a text-only session where `vision_analyze` exists but returns a
provider/HTTP error,
when the skill's delegation step runs,
then it spawns the `vision-agent` subagent with the same visual task.

#### Scenario: Unconfigured model does not fall back

Given a text-only session where `vision_analyze` returns the "model not
configured" error,
when the skill's delegation step runs,
then it reports the configuration fix to the user and does not spawn a
subagent.

### Requirement: VT-5: Endpoint and credentials resolve for the tool call

**Requirement:** The tool `SHALL` resolve the vision provider's base URL in
this order: (1) `provider.<id>.options.baseURL` from config, (2) an
endpoint from the provider's environment variables when the catalog declares
them (e.g. `MINIMAX_API_HOST`), (3) the provider's catalog `api` field,
else a built-in map of known vision endpoints, (4) otherwise a clear error.
The API key `SHALL` resolve from the provider's `auth.json` entry (type
`api`) first, then from the provider's declared environment variables. The
request `SHALL` use either the OpenAI-compatible `/chat/completions` shape
(image parts as `data:` base64 URLs) or the Anthropic-style `/messages`
shape (image parts as base64 content blocks), selected by the resolved
endpoint URL: endpoints whose URL marks an Anthropic-compatible base (e.g.
containing `/anthropic`) `SHALL` use the Anthropic shape, all others the
OpenAI shape. The shape split is required because some vision endpoints
(e.g. `api.minimaxi.com`) drop `data:` `image_url` parts on their
OpenAI-compatible endpoint while their Anthropic-style endpoint delivers
them (verified during the change's spike). When resolution or the request
fails, the error `SHALL` be descriptive enough for the skill's fallback
(VT-4) and for the user.

#### Scenario: Config baseURL wins

Given `provider.<id>.options.baseURL` is set to a custom endpoint,
when the tool resolves the endpoint,
then that base URL is used.

#### Scenario: Known provider default

Given a provider in the built-in endpoint map and no config/env override,
when the tool resolves the endpoint,
then the mapped default is used.

#### Scenario: Anthropic-style endpoint uses the /messages shape

Given a resolved base URL of `https://api.minimaxi.com/anthropic/v1`,
when the tool builds the request,
then the request is an Anthropic-style POST to `<base>/messages` with
base64 image content blocks and an `x-api-key` header.

#### Scenario: OpenAI-compatible endpoint uses the chat/completions shape

Given a resolved base URL without an Anthropic marker,
when the tool builds the request,
then the request is an OpenAI-compatible POST to `<base>/chat/completions`
with `data:` base64 `image_url` parts and a `Bearer` Authorization header.

#### Scenario: Unresolvable endpoint errors

Given a provider with no config baseURL, no env host, no catalog `api`
field, and no map entry,
when the tool resolves the endpoint,
then it returns a descriptive error and no request is made.

