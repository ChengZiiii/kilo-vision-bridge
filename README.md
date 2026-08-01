# Kilo Vision Bridge

> **Disclaimer:** Kilo Vision Bridge is an independent, community-built project. It is **not** built by, endorsed by, or affiliated with the Kilo team. It is a port of [wezzard/opencode-vision](https://github.com/wezzard/opencode-vision) (MIT) to the Kilo plugin SDK, and builds on its design.

## Introduction

Give text-only Kilo orchestrators (GLM-5.2, DeepSeek, and similar models) eyes by delegating visual tasks to a vision-capable model through a dynamically registered vision subagent.

When the orchestrator model is text-only and a task needs pixels — not just accessibility metadata — the plugin's `vision` skill detects the visual intent, extracts a task-specific JSON response template, delegates the task, and parses the structured findings back into the conversation.

**Tool-first architecture.** Delegation targets a native plugin tool, `vision_analyze`, registered through the `@kilocode/plugin` `tool` hook. The tool runs the visual judgment in-process — it reads the listed image files and calls the configured vision model directly, so **no subagent nesting is required** and the tool works from any session, including subagent sessions (depth >= 1) where spawning a further subagent would be blocked by `subagent_depth` and the auto-denied `task` tool. The skill calls `vision_analyze` first and falls back to spawning the `vision-agent` subagent only when the tool is unavailable in the session or the call fails with a provider/protocol/HTTP error. With the tool path, **`subagent_depth` / `permission.task` configuration is not needed** for visual delegation.

## Requirements

- Kilo 7.4+
- At least one configured provider with an image-capable model (`enabled_providers` and/or `provider` entries in Kilo config). The plugin discovers models from your configured providers and Kilo's cached model catalog (`~/.cache/kilo/models.json`) — it does not ship a fixed model list.

## Installation

```bash
# install globally (available to all projects) — installs the package and patches the config
kilo plugin kilo-vision-bridge --global

# or install for the current project only
kilo plugin kilo-vision-bridge
```

Pin a specific version with `kilo plugin kilo-vision-bridge@0.1.1`.

After install, restart Kilo. The plugin registers the `vision-agent` subagent and the `vision_analyze` tool on launch, and the `vision` skill is discovered straight from the installed package directory — no manual copy and no postinstall steps are needed.

> **Why the plugin entry lands in `opencode.json`?** `kilo plugin` writes server-type plugin entries to `~/.config/kilo/opencode.json` (a legacy config filename, fully read by Kilo on every launch). This is Kilo's official installer behavior, not a bug. You can move the entry to `kilo.jsonc` if you prefer — both files are read and merged — but note that re-running `kilo plugin` (e.g. to upgrade) will create `opencode.json` again, since that is where the official installer manages entries.
>
> **Where does the package itself live?** `kilo plugin` downloads and manages the package under `~/.cache/kilo/packages/<name>@<tag>/` — Kilo's own package store, by official design. Do not move or delete it manually; use `kilo plugin` for upgrades (e.g. `kilo plugin kilo-vision-bridge --global --force`). The package store is a cache: clearing `~/.cache/kilo` only forces a re-download on the next `kilo plugin` run.

### Uninstalling

`kilo plugin` has no uninstall subcommand (Kilo's `kilo uninstall` removes Kilo itself, not plugins), so removal is manual — two steps:

1. Remove the plugin entry from the config: delete `"kilo-vision-bridge"` from the `plugin` array in `~/.config/kilo/opencode.json` (or `kilo.jsonc`, wherever it lives). If the array becomes empty, remove the whole `plugin` key.
2. Delete the installed package from Kilo's package store: `~/.cache/kilo/packages/kilo-vision-bridge@latest/`.

Restart Kilo afterwards: the `vision-agent` subagent and `vision_analyze` tool disappear, and the `vision` skill is no longer listed.

## Quick start

1. Install with `kilo plugin kilo-vision-bridge --global` and restart Kilo.
2. Set the vision model (see below): `agent["vision-agent"].model = "<provider-id>/<model-id>"` — use any vision-capable model from your configured providers.
3. Drag an image into the Kilo input box (or reference an image path) and ask a visual question. The orchestrator detects the visual intent, delegates to `vision_analyze`, and the vision model returns structured JSON matching the template.

## Usage

### The vision model knob

The plugin registers **exactly one** subagent, `vision-agent`, WITHOUT a default model — the plugin never writes `model`. The vision model is set by **you** through the Kilo Code agent model override on `vision-agent`:

```jsonc
{
  "agent": {
    "vision-agent": {
      "model": "<provider-id>/<model-id>" // any vision-capable model from your configured providers
    }
  }
}
```

If no override is set, Kilo falls back to the default model.

This override is the **single vision model knob for both delegation paths**: the `vision_analyze` tool's model source is exactly this override, and the `vision-agent` subagent fallback uses it too. The plugin never writes the field, so your override is always preserved.

### Per-model vision routing

The plugin routes images based on the **handling model** of each request, not a single global toggle. The `vision-agent` subagent is always registered — regardless of the top-level `model` — so a text-only agent in a mixed config can always delegate.

- **Multimodal (vision-capable) model.** Image `FilePart`s pass through untouched in the messages transform — the model sees images natively. The system transform injects a `[vision:native]` instruction telling the model to inspect images directly and NOT use the vision skill, call `vision_analyze`, or spawn a `vision-agent` subagent.
- **Text-only model.** Image `FilePart`s are materialized under the plugin's temp dir and rewritten to `[vision:dropped-image]` markers carrying the resulting path. The orchestrator then delegates via the `vision_analyze` tool, falling back to the `vision-agent` subagent only when the tool is unavailable or errors with a provider/protocol/HTTP failure.

Capability is resolved per request: the messages transform checks the message's `info.model` first, then the agent's configured model, then the top-level config `model` as a final fallback. Provider/model ids match case-insensitively. To bypass the skill per task on a text-only model, prepend this to your prompt:

> You MUST not use the vision skill.

### The `vision_analyze` tool and permissions

The tool's arguments are `images` (`[{id, path}]` — short contract ids plus local image paths), `question` (the exact visual question), `response_template` (JSON string defining the required response shape), and optional `response_rules`. The tool reads the images, calls the configured vision model (OpenAI-compatible `/chat/completions` for OpenAI-style endpoints, Anthropic `/messages` for anthropic-style endpoints), and returns exactly one JSON object matching the template.

`vision_analyze` is auto-allowed: sessions — including subagent sessions — call it without permission prompts. An explicit user deny wins: set `permission.vision_analyze = "deny"` and the tool is removed from every session's toolset (the skill then cannot delegate via the tool). The plugin never downgrades a deny.

### Disabling vision delegation

To stop delegation entirely, disable `vision-agent` in Kilo Code: set `disable: true` on `agent["vision-agent"]`. This disables **both** paths: the agent does not appear in `kilo agent list` and cannot be delegated to, and the `vision_analyze` tool is not registered in any session. The plugin never writes `disable`, so your setting stays effective.

## Troubleshooting

- **Plugin not loading:** run Kilo with `kilo --print-logs --log-level DEBUG` and check the output for plugin load errors.
- **Stale plugin cache:** reset the plugin cache under `~/.cache/kilo` (or the legacy `~/.cache/opencode/packages` directory) and restart Kilo.
- **Missing `vision-agent` subagent / `vision_analyze` tool:** no model is pre-configured — set one via the Kilo Code agent model override on `vision-agent`. Confirm the override is set and that `~/.cache/kilo/models.json` contains the provider. The tool is also absent when `disable: true` is set on `vision-agent`.
- **`vision_analyze` returns "model not configured":** set `agent["vision-agent"].model` to a vision-capable provider/model from your configured providers; the skill does not fall back on this error.
- **`vision_analyze` returns a provider error:** check the API key (`kilo auth` / `auth.json` entry for the provider, or its `*_API_KEY` env var) and the endpoint (`provider.<id>.options.baseURL` in config, else the provider's catalog/built-in endpoint). The skill automatically falls back to the `vision-agent` subagent on provider/protocol/HTTP errors.

## License

MIT — see [LICENSE](./LICENSE).

Upstream design and implementation: [wezzard/opencode-vision](https://github.com/wezzard/opencode-vision), MIT. See also [I Gave GLM-5.2 Eyes](https://wezzard.com/post/2026/06/i-gave-glm-5-2-eyes-d896) for the design rationale.
