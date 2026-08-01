# Remove Skill Mirror Sync Spec

## ADDED Requirements

### Requirement: RB-9: Skill discovery is package-path based

**Requirement:** The plugin `SHALL` register the vision skill for discovery
by pushing the package data dir (the directory containing `SKILL.md`) onto
`config.skills.paths` in the `config` hook. The plugin `SHALL NOT` write,
copy, or sync `SKILL.md` (or any mirror of it) into the Kilo config skills
directory (`~/.config/kilo/skills/` or equivalent) at module load or at any
other time. Skill discovery `SHALL` come from the installed package
directory, which resolves from the plugin's own location
(`import.meta.url`) so it follows package upgrades automatically. Method B
(single-file `~/.config/kilo/plugin/vision.js`) installs `SHALL` rely on the
documented manual `SKILL.md` copy.

#### Scenario: Package install discovers the skill without a mirror

Given a package install (Method A `file://` path or npm) with NO
`~/.config/kilo/skills/vision/SKILL.md` file present,
when the plugin loads and skills are scanned,
then the `vision` skill is discoverable from the installed package
directory via `skills.paths`.

#### Scenario: Module load performs no config-dir writes

Given the plugin loads,
when module evaluation runs,
then no file is written under the Kilo config skills directory
(`~/.config/kilo/skills/` or equivalent).

## MODIFIED Requirements

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
the note that the skill is discovered from the installed package directory
via `skills.paths` (no module-load mirror sync; `scripts/install-skill.mjs`
remains as a manual install aid for setups where postinstall scripts run;
Method B requires a manual `SKILL.md` copy), troubleshooting (`KILO_PURE`,
`--log-level DEBUG`, plugin cache reset), and attribution to the upstream
MIT project.

#### Scenario: Installation method verified

Given the README lists the three loading methods,
then each method is marked with the result of the on-machine test performed
during the port change (works / does not work on Kilo 7.4.17).

#### Scenario: Skill discovery documented without module-load sync

Given the README describes skill installation,
then it states the skill is discovered from the installed package directory
via `skills.paths` and does not claim a module-load mirror sync.
