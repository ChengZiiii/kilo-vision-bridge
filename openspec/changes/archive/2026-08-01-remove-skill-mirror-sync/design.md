# Design

## 1. plugin.ts: delete the mirror sync

- Delete the `ensureSkillInstalled` function and its module-load call
  (`ensureSkillInstalled()` after the function definition).
- Remove `cpSync` from the `node:fs` import (no longer used). `readFileSync`,
  `existsSync`, `writeFileSync`, `copyFileSync` (used by `saveImagePart`),
  and `mkdirSync` stay.
- Keep `bundleDir` / `candidateDirs` / `dataDir` resolution — the config
  hook still pushes `dataDir` onto `cfg.skills.paths`, which is the sole
  discovery mechanism for package installs.
- Update the config-hook comment block that currently frames the sync as
  primary and the path push as fallback ("Register the skill in-place:
  push the package data dir...") — it should state that package-dir
  discovery via `skills.paths` is the only mechanism; Method B installs
  copy `SKILL.md` manually per the README.

## 2. README.md

Rewrite section "5. Skill Sync and npm Install Scripts":

- Skill discovery comes from the installed package directory pushed onto
  `config.skills.paths` — no postinstall copy, no symlink, no module-load
  sync; the skill is usable on the first launch after install.
- `scripts/install-skill.mjs` (package.json `postinstall`) remains as an
  aid for manual installs where postinstall scripts do run.
- Method B: the skill must be copied manually to
  `~/.config/kilo/skills/vision/SKILL.md` on first install.
- Any other README mention of "syncs SKILL.md ... at module load" is
  replaced accordingly.

## 3. AGENTS.md

- 架构总览 table row for `plugin.ts`: "skill 自动同步" →
  "skills.paths 注册（包内直扫）".
- 开发循环 item 2: "SKILL.md 改动零手动：启动时自动同步到
  ~/.config/kilo/skills/vision/SKILL.md" → "SKILL.md 改动零手动：改完重启
  即生效（skill 从包目录经 skills.paths 直扫，无同步/复制步骤）".
- 安装方式 section: the mirror bullet
  ("~/.config/kilo/skills/vision/ 是插件自动维护的镜像缓存，可删可留") →
  "插件不写 ~/.config/kilo/skills/；Method B 需手动复制 SKILL.md".
- 测试与构建 / 关键设计决策: unchanged.

## 4. Files

| File | Change |
| ---- | ------ |
| `plugin.ts` | delete `ensureSkillInstalled` + call; drop `cpSync` import; comment update |
| `README.md` | section 5 rewrite; drop module-load sync claims |
| `AGENTS.md` | dev-loop / architecture / install bullets |
| spec delta | ADDED RB-9, MODIFIED RB-7 |

## 5. Verification

- `node --test tests/*.test.mjs` (unchanged — core untouched), `bun run
  typecheck`, `bun run build`.
- Sandbox (KILO_CONFIG_DIR/KILO_TEST_HOME/KILO_DATA_DIR): launch the
  plugin, then assert no file was created under the sandbox config
  `skills/` directory (RB-9 scenario 2).
- Skill discovery from the package path: evidence that a session resolves
  the `vision` skill from the repo path (already the case today — the
  orchestrator's skill list references
  `.../kilo-vision-bridge/SKILL.md`, not the mirror).
- Live: `kilo agent list` still registers `vision-agent`; tool still
  callable.

## 6. Commits

1. `plugin: remove module-load skill mirror sync`
2. `docs: describe package-dir skill discovery`
