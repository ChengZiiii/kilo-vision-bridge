# Vision Analyze Tool Spec

## ADDED Requirements

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
them (e.g. `MINIMAX_API_HOST`), (3) a built-in map of known OpenAI-compatible
endpoints, (4) otherwise a clear error. The API key `SHALL` resolve from the
provider's `auth.json` entry (type `api`) first, then from the provider's
declared environment variables. The request `SHALL` use the OpenAI-compatible
`/chat/completions` shape with image parts as `data:` base64 URLs. When
resolution or the request fails, the error `SHALL` be descriptive enough for
the skill's fallback (VT-4) and for the user.

#### Scenario: Config baseURL wins

Given `provider.<id>.options.baseURL` is set to a custom endpoint,
when the tool resolves the endpoint,
then that base URL is used.

#### Scenario: Known provider default

Given a provider in the built-in endpoint map and no config/env override,
when the tool resolves the endpoint,
then the mapped default is used.

#### Scenario: Unresolvable endpoint errors

Given a provider with no config baseURL, no env host, and no map entry,
when the tool resolves the endpoint,
then it returns a descriptive error and no request is made.

## MODIFIED Requirements

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

#### Scenario: Disabled agent disables both paths

Given the user sets `agent["vision-agent"].disable = true` in Kilo Code,
when the config hook runs and the tool registry is inspected,
then `vision-agent` does not appear in `kilo agent list` and
`vision_analyze` is not registered.

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
