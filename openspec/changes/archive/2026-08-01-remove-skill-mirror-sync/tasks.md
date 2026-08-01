# Tasks

## 1. plugin.ts: delete the mirror sync

- [x] 1.1 Delete `ensureSkillInstalled` and its module-load call
- [x] 1.2 Drop the now-unused `cpSync` import (keep readFileSync /
      existsSync / writeFileSync / copyFileSync / mkdirSync)
- [x] 1.3 Keep `dataDir` resolution and the `skills.paths` push; update the
      config-hook comment to state package-dir discovery is the only
      mechanism (Method B copies manually)

## 2. README.md

- [x] 2.1 Rewrite section "5. Skill Sync and npm Install Scripts":
      discovery via `skills.paths` from the installed package dir; no
      module-load sync; `scripts/install-skill.mjs` remains a manual
      install aid; Method B requires a manual SKILL.md copy
- [x] 2.2 Remove any other module-load sync claims

## 3. AGENTS.md

- [x] 3.1 架构总览 plugin.ts row: "skill 自动同步" -> "skills.paths 注册
      （包内直扫）"
- [x] 3.2 开发循环 item 2: SKILL.md 改动重启即生效，无同步步骤
- [x] 3.3 安装方式 section: 插件不再写 ~/.config/kilo/skills/（Method B
      手动复制不变）

## 4. Verification

- [x] 4.1 `node --test tests/*.test.mjs`, `bun run typecheck`,
      `bun run build`
- [x] 4.2 Sandbox launch: no file created under the sandbox config
      `skills/` directory (RB-9 scenario 2)
- [x] 4.3 Skill discoverable from the package path (no mirror present)
- [x] 4.4 Live: `kilo agent list` still shows `vision-agent`

## 5. Commits

- [x] 5.1 `plugin: remove module-load skill mirror sync`
- [x] 5.2 `docs: describe package-dir skill discovery`
