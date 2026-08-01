# Kilo Vision Bridge

> **Disclaimer:** Kilo Vision Bridge is an independent, community-built project. It is **not** built by, endorsed by, or affiliated with the Kilo team. It is a port of [wezzard/opencode-vision](https://github.com/wezzard/opencode-vision) (MIT) to the Kilo plugin SDK, and builds on its design.

## Introduction

Give text-only Kilo orchestrators (GLM-5.2, DeepSeek, and similar models) eyes by delegating visual tasks to dynamically registered vision subagents.

When the orchestrator model is text-only and a task needs pixels — not just accessibility metadata — the plugin's `vision` skill detects the visual intent, extracts a task-specific JSON response template, delegates the task, and parses the structured findings back into the conversation.

**Tool-first architecture.** Delegation targets a native plugin tool, `vision_analyze`, registered through the `@kilocode/plugin` `tool` hook. The tool runs the visual judgment in-process — it reads the listed image files and calls the configured vision model directly, so **no subagent nesting is required** and the tool works from any session, including subagent sessions (depth >= 1) where spawning a further subagent would be blocked by `subagent_depth` and the auto-denied `task` tool. The skill calls `vision_analyze` first and falls back to spawning the `vision-agent` subagent only when the tool is unavailable in the session or the call fails with a provider/protocol/HTTP error. With the tool path, **`subagent_depth` / `permission.task` configuration is not needed** for visual delegation.

## Installation

> **Verification:** all three loading methods below were tested on-machine on Kilo 7.4.17; each section records its verified result.

Configure at least one provider with an image-capable model (`enabled_providers` and/or `provider` entries in Kilo config). The plugin discovers models from your configured providers and Kilo's cached model catalog (`~/.cache/kilo/models.json`) — it does not ship a fixed model list.

### Method A — `plugin` array in `kilo.jsonc`

Add the package to the `plugin` array in `~/.config/kilo/kilo.jsonc`, by npm package name or by a `file://` path to the package directory.

**Verification result (Kilo 7.4.17): works — recommended.** `kilo agent list` shows the single `vision-agent` subagent (no plugin-assigned model; the user sets the model via the Kilo Code agent model override) and the plugin loads with no errors.

### Method B — `~/.config/kilo/plugin/` directory

Copy the built `dist/index.js` to `~/.config/kilo/plugin/vision.js`. The plugin is a single self-contained file: the `vision-agent` prompt body is inlined, and the plugin needs no sibling data files (no `subagent-body.md`, no `scripts/`). Do **not** place `SKILL.md` in this directory: Kilo blocks skill files referenced from inside the config directory ("blocked file reference outside project config scope") and logs a load error on every launch. The skill instead lives at `~/.config/kilo/skills/vision/SKILL.md` — copy `SKILL.md` there manually on first install.

**Naming convention:** each plugin in the auto-load directory is one file named after the plugin — `vision.js` for this plugin. Other plugins get their own files; the filename identifies the plugin.

**Verification result (Kilo 7.4.17): works.** `kilo agent list` shows the single `vision-agent` subagent and the plugin loads with no errors.

### Method C — `kilo plugin` command

```bash
kilo plugin kilo-vision-bridge
```

**Verification result (Kilo 7.4.17): requires `npm publish` first.** Before the package is published, the command fails cleanly (404 from `registry.npmjs.org`, exit 1, config untouched). After `npm publish`, `kilo plugin kilo-vision-bridge --global` installs the package and patches the config.

## Usage

### 1. Running Visual Tasks

**Image as user input:** drag an image into the Kilo input box, or reference an image path in your message.

**Image as tool results:** the same flow applies to screenshots from browser and computer-use tools (chrome-devtools, Playwright, cua-driver, and similar).

### 2. Setting the Vision Model

The plugin registers **exactly one** subagent, `vision-agent`, WITHOUT a default model — the plugin never writes `model`. The vision model is set by **you** through the Kilo Code agent model override on `vision-agent` (e.g. `agent["vision-agent"].model = "minimax-cn-coding-plan/MiniMax-M3"`). If no override is set, Kilo falls back to the default model.

This override is the **single vision model knob for both delegation paths**: the `vision_analyze` tool's model source is exactly this override, and the `vision-agent` subagent fallback uses it too. The plugin never writes the field.

### 3. Changing the Vision Model

Change the Kilo Code agent model override on `vision-agent` to another id (e.g. `minimax-cn-coding-plan/MiniMax-M3`). The plugin never reads or writes the field beyond using it as the tool's model source, so your override is always preserved.

### 4. The `vision_analyze` Tool and Permissions

The plugin registers the native `vision_analyze` tool on every launch (unless `vision-agent` is disabled — see below). Its arguments are `images` (`[{id, path}]` — short contract ids plus local image paths), `question` (the exact visual question), `response_template` (JSON string defining the required response shape), and optional `response_rules`. The tool reads the images, calls the configured vision model (OpenAI-compatible `/chat/completions` for OpenAI-style endpoints, Anthropic `/messages` for anthropic-style endpoints such as `minimax-cn-coding-plan`), and returns exactly one JSON object matching the template.

**Permission behavior.** `vision_analyze` is auto-allowed: sessions — including subagent sessions — call it without permission prompts. An explicit user deny wins: set `permission.vision_analyze = "deny"` and the tool is removed from every session's toolset (the skill then cannot delegate via the tool). The plugin never downgrades a deny.

### 5. Per-Model Vision Routing

The plugin routes images based on the **handling model** of each request, not a single global toggle. The single `vision-agent` subagent is always registered — regardless of the top-level `model` — so a text-only agent in a mixed config can always delegate.

- **Multimodal (vision-capable) model.** Image `FilePart`s pass through untouched in the messages transform — the model sees images natively. The system transform injects a `[vision:native]` instruction telling the model to inspect images directly and NOT use the vision skill, call `vision_analyze`, or spawn a `vision-agent` subagent. No `[vision:dropped-image]` marker is produced.
- **Text-only model.** Image `FilePart`s are materialized under the plugin's temp dir and rewritten to `[vision:dropped-image]` markers carrying the resulting path. The orchestrator then delegates via the `vision_analyze` tool, falling back to the `vision-agent` subagent only when the tool is unavailable or errors with a provider/protocol/HTTP failure (model from the user's override).

Capability is resolved per request: the messages transform checks the message's `info.model` first, then the agent's configured model, then the top-level config `model` as a final fallback. Provider/model ids match case-insensitively. To bypass the skill per task on a text-only model, prepend this to your prompt:

> You MUST not use the vision skill.

### 6. Disabling Vision Delegation

To stop delegation entirely, disable `vision-agent` in Kilo Code: set `disable: true` on `agent["vision-agent"]`. This disables **both** paths: the agent does not appear in `kilo agent list` and cannot be delegated to, and the `vision_analyze` tool is not registered in any session. The plugin never writes `disable`, so your setting stays effective.

### 7. Skill Sync and npm Install Scripts

Kilo disables npm install/postinstall scripts for npm plugins, so a `postinstall` hook cannot be relied on to install the skill. The plugin therefore syncs `SKILL.md` to `~/.config/kilo/skills/vision/SKILL.md` at **module load** — which runs before skill discovery on the same launch, so the skill is usable on the first launch after install — and additionally pushes the package data dir onto `config.skills.paths` as a fallback. The `postinstall` script in `package.json` remains as belt-and-suspenders for manual installs.

## Troubleshooting

- **Plugin not loading:** run Kilo with `kilo --print-logs --log-level DEBUG` and check the output for plugin load errors.
- **Isolating plugin interference:** start Kilo with `KILO_PURE=1` to disable plugins and custom configuration; if the problem disappears, the plugin is the culprit.
- **Stale plugin cache:** reset the plugin cache under `~/.cache/kilo` (or the legacy `~/.cache/opencode/packages` directory) and restart Kilo.
- **Missing `vision-agent` subagent / `vision_analyze` tool:** no model is pre-configured — set one via the Kilo Code agent model override on `vision-agent`. Confirm the override is set and that `~/.cache/kilo/models.json` contains the provider. The tool is also absent when `disable: true` is set on `vision-agent`.
- **`vision_analyze` returns "model not configured":** same fix — set `agent["vision-agent"].model` to a vision-capable provider/model (e.g. `minimax-cn-coding-plan/MiniMax-M3`); the skill does not fall back on this error.
- **`vision_analyze` returns a provider error:** check the API key (`kilo auth` / `auth.json` entry for the provider, or its `*_API_KEY` env var) and the endpoint (`provider.<id>.options.baseURL` in config, else the provider's catalog/built-in endpoint). The skill automatically falls back to the `vision-agent` subagent on provider/protocol/HTTP errors.

## License

MIT — see [LICENSE](./LICENSE).

Upstream design and implementation: [wezzard/opencode-vision](https://github.com/wezzard/opencode-vision), MIT. See also [I Gave GLM-5.2 Eyes](https://wezzard.com/post/2026/06/i-gave-glm-5-2-eyes-d896) for the design rationale.
