# Kilo Vision Bridge

> **Disclaimer:** Kilo Vision Bridge is an independent, community-built project. It is **not** built by, endorsed by, or affiliated with the Kilo team. It is a port of [wezzard/opencode-vision](https://github.com/wezzard/opencode-vision) (MIT) to the Kilo plugin SDK, and builds on its design.

## Introduction

Give text-only Kilo orchestrators (GLM-5.2, DeepSeek, and similar models) eyes by delegating visual tasks to dynamically registered vision subagents.

When the orchestrator model is text-only and a task needs pixels — not just accessibility metadata — the plugin's `vision` skill detects the visual intent, extracts a task-specific JSON response template, delegates the task to a `vision-*` subagent backed by an image-capable model, and parses the structured findings back into the conversation.

## Installation

> **Verification:** all three loading methods below were tested on-machine on Kilo 7.4.17; each section records its verified result.

Configure at least one provider with an image-capable model (`enabled_providers` and/or `provider` entries in Kilo config). The plugin discovers models from your configured providers and Kilo's cached model catalog (`~/.cache/kilo/models.json`) — it does not ship a fixed model list.

### Method A — `plugin` array in `kilo.jsonc`

Add the package to the `plugin` array in `~/.config/kilo/kilo.jsonc`, by npm package name or by a `file://` path to the package directory.

**Verification result (Kilo 7.4.17): works — recommended.** `kilo agent list` shows all `vision-*` subagents (including `vision-minimax-cn-coding-plan-MiniMax-M3`) and the plugin loads with no errors.

### Method B — `~/.config/kilo/plugin/` directory

Copy the built package layout into Kilo's auto-load plugin directory `~/.config/kilo/plugin/`: `dist/index.js` plus the sibling data files the bundle reads at module load (`SKILL.md`, `subagent-body.md`, and the `scripts/` directory).

**Verification result (Kilo 7.4.17): works only with the full package layout.** Copying a lone `dist/index.js` is silently skipped by Kilo — the module-load read of `subagent-body.md` throws when the sibling files are absent, so the plugin never loads and no error is surfaced. With the full layout copied, `kilo agent list` shows the `vision-*` subagents. Prefer Method A unless you specifically need the auto-load directory.

### Method C — `kilo plugin` command

```bash
kilo plugin kilo-vision-bridge
```

**Verification result (Kilo 7.4.17): requires `npm publish` first.** Before the package is published, the command fails cleanly (404 from `registry.npmjs.org`, exit 1, config untouched). After `npm publish`, `kilo plugin kilo-vision-bridge --global` installs the package and patches the config.

## Usage

### 1. Running Visual Tasks

**Image as user input:** drag an image into the Kilo input box, or reference an image path in your message.

**Image as tool results:** the same flow applies to screenshots from browser and computer-use tools (chrome-devtools, Playwright, cua-driver, and similar).

### 2. Picking the Vision Model

On the first visual task, the orchestrator runs the bundled model discovery script (`node <package>/scripts/vision-models.mjs`) and presents a short list of image-capable models from your configured providers. Pick one — that selection is persisted for future sessions.

Your choice is saved to `~/.config/kilo/vision-model-image.txt` and reused in later sessions: at startup the plugin reads the file and, if it holds a known model id, appends `[vision:model-choice] model=<provider/model>` to the system prompt so the orchestrator does not re-ask. A vision subagent inspects the image and returns structured findings as text for the main agent to relay.

### 3. Re-picking the Vision Model

Re-picking the vision model is very simple: just say, **"Select the vision model."**

### 4. Per-Model Vision Routing

The plugin routes images based on the **handling model** of each request, not a single global toggle. `vision-*` subagents are always registered regardless of the top-level `model`, so a text-only agent in a mixed config can always delegate.

- **Multimodal (vision-capable) model.** Image `FilePart`s pass through untouched in the messages transform — the model sees images natively. The system transform injects a `[vision:native]` instruction telling the model to inspect images directly and NOT use the vision skill or spawn a `vision-*` subagent. No `[vision:dropped-image]` marker is produced.
- **Text-only model.** Image `FilePart`s are materialized under the plugin's temp dir and rewritten to `[vision:dropped-image]` markers carrying the resulting path. The system transform injects `[vision:model-script]` (and `[vision:model-choice]` when a persisted choice exists) so the orchestrator picks a vision model and delegates to the matching `vision-*` subagent.

Capability is resolved per request: the messages transform checks the message's `info.model` first, then the agent's configured model, then the top-level config `model` as a final fallback. Provider/model ids match case-insensitively. To bypass the skill per task on a text-only model, prepend this to your prompt:

> You MUST not use the vision skill.

### 5. Skill Sync and npm Install Scripts

Kilo disables npm install/postinstall scripts for npm plugins, so a `postinstall` hook cannot be relied on to install the skill. The plugin therefore syncs `SKILL.md` to `~/.config/kilo/skills/vision/SKILL.md` at **module load** — which runs before skill discovery on the same launch, so the skill is usable on the first launch after install — and additionally pushes the package data dir onto `config.skills.paths` as a fallback. The `postinstall` script in `package.json` remains as belt-and-suspenders for manual installs.

## Troubleshooting

- **Plugin not loading:** run Kilo with `kilo --print-logs --log-level DEBUG` and check the output for plugin load errors.
- **Isolating plugin interference:** start Kilo with `KILO_PURE=1` to disable plugins and custom configuration; if the problem disappears, the plugin is the culprit.
- **Stale plugin cache:** reset the plugin cache under `~/.cache/kilo` (or the legacy `~/.cache/opencode/packages` directory) and restart Kilo.
- **Missing `vision-*` subagents:** confirm at least one configured provider exposes an image-capable model, and that `~/.cache/kilo/models.json` contains the provider. Run `node <package>/scripts/vision-models.mjs` to see which models the plugin discovers.

## License

MIT — see [LICENSE](./LICENSE).

Upstream design and implementation: [wezzard/opencode-vision](https://github.com/wezzard/opencode-vision), MIT. See also [I Gave GLM-5.2 Eyes](https://wezzard.com/post/2026/06/i-gave-glm-5-2-eyes-d896) for the design rationale.
