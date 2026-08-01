# Tasks

## 1. plugin.ts: single-file refactor

- [x] 1.1 Inline `bodyTpl` as a constant (current subagent-body.md content,
      placeholder-free); remove the file read and degraded fallback
- [x] 1.2 `dataDir` resolution keys off `SKILL.md`
      (`candidateDirs.find(d => existsSync(join(d, "SKILL.md"))) ?? bundleDir`)
- [x] 1.3 Delete `VISION_MODELS_SCRIPT`; system transform text-only branch
      injects nothing; `[vision:native]` drops the model-script mention

## 2. Deletions + manifest

- [x] 2.1 Delete `scripts/vision-models.mjs` and `subagent-body.md`
- [x] 2.2 `package.json`: drop `models` script; update `files` (keep
      `scripts` only if `install-skill.mjs` remains) and the description

## 3. SKILL.md

- [x] 3.1 Remove model-script / model-picker flow (Step 4 collapses to:
      model configured by user via Kilo Code override; ask user if unset)
- [x] 3.2 Remove script/picker examples and `question()` snippet;
      delegation to `vision-agent` unchanged

## 4. README.md

- [x] 4.1 Method B = single file `~/.config/kilo/plugin/vision.js`; naming
      convention (one file per plugin)
- [x] 4.2 Remove all script references (§2/§3/troubleshooting)

## 5. Verification

- [x] 5.1 Harness: `vision-agent` registered with the inlined prompt; system
      transform text model injects no `[vision:model-script]` /
      `[vision:model-choice]`; multimodal model gets `[vision:native]`
- [x] 5.2 Harness: plugin loads with NO sibling files (single-file scenario)
- [x] 5.3 `bun run typecheck`, `bun run build`
- [x] 5.4 Live (sandbox): plugin dir contains ONLY `vision.js` →
      `kilo agent list` shows exactly one `vision-agent`, no errors

## 6. Commits

- [x] 6.1 `plugin: inline subagent body and drop model script`
- [x] 6.2 `skill: remove model-script picker flow`
- [x] 6.3 `docs: document single-file install and naming`
