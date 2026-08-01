# Design

## 1. plugin.ts: inline body, SKILL.md-keyed dataDir, no script

- `bodyTpl`: replace the file-read + degraded-fallback block with an inline
  template constant containing the current `subagent-body.md` content
  (placeholder-free). Delete the file read and the fallback.
- `dataDir` resolution:
  ```ts
  const dataDir =
    candidateDirs.find((d) => existsSync(join(d, "SKILL.md"))) ?? bundleDir
  ```
  Npm install: package root (one level up from dist/) has SKILL.md → dataDir
  = package root → skill sync + skills.paths work. Plugin-directory install:
  no SKILL.md sibling → fallback bundleDir (harmless: sync source missing,
  skills.paths scan finds no SKILL.md).
- Delete `VISION_MODELS_SCRIPT`.
- System transform text-only branch: push nothing (no `[vision:model-script]`,
  no `[vision:model-choice]`). `[vision:native]` text drops the
  "ignore any [vision:model-script] instructions" sentence.

## 2. Deletions and package manifest

- Delete `scripts/vision-models.mjs` and `subagent-body.md`.
- `package.json`: remove the `models` npm script; remove `scripts` (if it
  only held the deleted file — `install-skill.mjs` stays, so keep `scripts`
  in `files` only if it still exists) and `subagent-body.md` from `files`;
  update the description to single `vision-agent` wording.

## 3. SKILL.md

- Remove the model-script / model-picker flow entirely: Step 4 collapses to
  "the `vision-agent` model is configured by the user via the Kilo Code
  agent model override; if none is set, ask the user to configure one".
  Remove `[vision:model-script]` references, the picker example, the script
  response-shape example, and the `question()` snippet.
- Step 5 delegation to `vision-agent` unchanged.

## 4. README

- Method B becomes: copy `dist/index.js` to
  `~/.config/kilo/plugin/vision.js` — one file per plugin; document the
  naming convention (the filename identifies the plugin; other plugins get
  their own files).
- Remove all script references from §2/§3/troubleshooting.

## 5. Files

| File | Change |
| ---- | ------ |
| `plugin.ts` | inline body; dataDir via SKILL.md; drop script + model-script injection |
| `scripts/vision-models.mjs` | deleted |
| `subagent-body.md` | deleted (content inlined) |
| `package.json` | manifest cleanup |
| `SKILL.md` | drop picker flow |
| `README.md` | single-file install + naming |

## 6. Verification

- Harness: config hook registers `vision-agent` with the inlined prompt;
  system transform (text model) injects NO `[vision:model-script]` /
  `[vision:model-choice]`; multimodal model still gets `[vision:native]`;
  plugin loads with no sibling files at all (single-file scenario).
- `bun run typecheck` + `bun run build`.
- Live (sandbox): plugin dir contains ONLY `vision.js` → `kilo agent list`
  shows exactly one `vision-agent`, no errors.

## 7. Commits

1. `plugin: inline subagent body and drop model script`
2. `skill: remove model-script picker flow`
3. `docs: document single-file install and naming`
