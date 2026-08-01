# Proposal: Remove skill mirror sync (package-dir discovery only)

## Intent

The plugin currently mirrors `SKILL.md` into
`~/.config/kilo/skills/vision/SKILL.md` at module load
(`ensureSkillInstalled`). Under package installs (Method A `file://` path and
npm), this mirror is redundant: the config hook already pushes the package
data dir onto `config.skills.paths`, so Kilo discovers the skill in place
from the installed package — verified on Kilo 7.4.17 (skills list resolves
the skill from the package path, not the mirror). The mirror only "mattered"
for Method B single-file installs, where the plugin has no SKILL.md source
and the copy is manual anyway.

The module-load write is also the source of a transient skill-parse race
seen after switching installs (first-launch mirror write can be observed by
the skill scanner mid-write). Removing it eliminates that window and stops
the plugin writing into the user's config skills directory.

## Scope

In scope:

- `plugin.ts`: delete `ensureSkillInstalled` and its module-load call; drop
  the now-unused `cpSync` import; keep the `dataDir` resolution and the
  `skills.paths` push (the real discovery mechanism); update the config-hook
  comment that described the sync as primary and the path push as fallback.
- `README.md`: rewrite the "Skill Sync and npm Install Scripts" section —
  skill discovery comes from the installed package dir via `skills.paths`;
  no module-load sync; `scripts/install-skill.mjs` remains as a manual
  install aid (and for installs where postinstall scripts run); Method B
  still requires a manual `SKILL.md` copy.
- `AGENTS.md`: update the development-loop note (SKILL.md edits are picked
  up from the package on restart; no sync step), the architecture table row
  for `plugin.ts`, and the installation-methods mirror bullet (the config
  skills dir is no longer written; Method B manual copy unchanged).
- openspec spec delta: ADDED RB-9 (package-path skill discovery, no
  module-load mirror writes), MODIFIED RB-7 (README wording).

Out of scope:

- `scripts/install-skill.mjs` behavior and RB-3 — unchanged (still useful
  for manual installs).
- `SKILL.md` content — unchanged.
- Deleting the already-existing mirror file on the user's machine (a
  one-time manual cleanup after this change; the plugin simply stops
  maintaining it).

## Approach

1. Delete `ensureSkillInstalled` (function + call) and the `cpSync` import.
   The config hook keeps pushing `dataDir` onto `config.skills.paths` —
   skill discovery continues from the package directory on the same launch.
2. Update README / AGENTS.md wording.
3. Verify: no writes into `~/.config/kilo/skills/` after a sandbox launch;
   skill still discoverable from the package path; typecheck/build/tests
   green.
