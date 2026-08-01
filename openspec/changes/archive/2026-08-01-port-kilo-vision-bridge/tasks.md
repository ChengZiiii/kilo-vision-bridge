# Tasks

## 1. Package manifest (RB-1)

- [x] 1.1 Set `peerDependencies["@kilocode/plugin"]` to `^7.4.0`
- [x] 1.2 Set `devDependencies["@kilocode/plugin"]` to `^7.4.0`
- [x] 1.3 Add `"engines": { "opencode": "^7.0.0" }`
- [x] 1.4 `bun install` to regenerate `bun.lock` with `@kilocode/plugin` 7.x
- [x] 1.5 Commit: `chore: fix @kilocode/plugin peer deps and engines range`

## 2. Port scripts/vision-models.mjs (RB-2, RB-4, RB-5)

- [x] 2.1 Rename `opencodeConfigDir/CacheDir/DataDir/ModelsFile` and
      `loadOpenCodeConfig` to kilo equivalents; usage/help text says "Kilo"
- [x] 2.2 Replace all `OPENCODE_*` env vars with `KILO_*`
      (`KILO_TEST_HOME`, `KILO_CWD`, `KILO_WORKTREE`, `KILO_CONFIG`,
      `KILO_DISABLE_PROJECT_CONFIG`, `KILO_CONFIG_CONTENT`,
      `KILO_AUTH_CONTENT`, `KILO_CONFIG_DIR`, `KILO_DATA_DIR`,
      `KILO_MODELS_PATH`, `KILO_MODELS_URL`)
- [x] 2.3 Config discovery: `config.json`/`opencode.json`/`opencode.jsonc` →
      `kilo.json`/`kilo.jsonc`; `.opencode` dirs → `.kilo`; home `.opencode` →
      `.kilo`; `kilo.jsonc` wins over `kilo.json` in the same directory
- [x] 2.4 Error/warning texts: "OpenCode cached model file" →
      "Kilo cached model file"; warning copy mentions Kilo
- [x] 2.5 Case-insensitive matching: folded catalog index for provider and
      model lookup, whitelist/blacklist, `--model` validation, persisted
      choice resolution; canonical casing in output ids
- [x] 2.6 Status filter: skip only `deprecated` (align with plugin.ts)
- [x] 2.7 Commit: `scripts: port vision-models.mjs to kilo paths`

## 3. Port scripts/install-skill.mjs (RB-3)

- [x] 3.1 Destination `~/.config/kilo/skills/vision/SKILL.md` honoring
      `KILO_CONFIG_DIR` / `XDG_CONFIG_HOME`
- [x] 3.2 Log prefix `kilo-vision-bridge`
- [x] 3.3 Commit: `scripts: port install-skill.mjs to kilo paths`

## 4. plugin.ts matching fixes (RB-4)

- [x] 4.1 Folded provider/model lookup in `providerModels`,
      `configuredModelVisionCapable`, `modelAllowed`,
      `readPersistedChoice`; canonical ids in `registeredModels` keys and
      subagent names
- [x] 4.2 Commit: `plugin: match provider/model ids case-insensitively`

## 5. SKILL.md port (RB-6)

- [x] 5.1 `opencode-vision` temp subdir → `kilo-vision-bridge`
      (Source D examples)
- [x] 5.2 `~/.config/opencode/vision-model-image.txt` →
      `~/.config/kilo/vision-model-image.txt`; choice-file example path
- [x] 5.3 "OpenCode" terminology → Kilo; script invocation example uses the
      package path
- [x] 5.4 Commit: `skill: update vision SKILL.md for kilo`

## 6. README rewrite (RB-7)

- [x] 6.1 Rewrite title/intro for kilo-vision-bridge, attribution to
      upstream MIT project
- [x] 6.2 Document the three install methods with on-machine verification
      results (Kilo 7.4.17)
- [x] 6.3 Document: postinstall blocked → module-load skill sync;
      bypass prompt for vision-capable main models; troubleshooting
      (`KILO_PURE`, `--log-level DEBUG`, plugin cache reset);
      model selection flow (`vision-model-image.txt`)
- [x] 6.4 Commit: `docs: rewrite README for kilo-vision-bridge`

## 7. Lockfile and build (RB-1)

- [x] 7.1 `bun.lock` regenerated and committed (with manifest change)
- [x] 7.2 `bun run build` produces `dist/index.js`

## 8. Verification (RB-8)

- [x] 8.1 `node scripts/vision-models.mjs` lists configured image-capable
      models incl. `minimax-cn-coding-plan/MiniMax-M3`
- [x] 8.2 `--model <provider/model>` persists and re-reads the choice
- [x] 8.3 Method A: `plugin` array in kilo.jsonc — test and record result
- [x] 8.4 Method B: copy dist to `~/.config/kilo/plugin/` — test and record
      result
- [x] 8.5 Method C: `kilo plugin kilo-vision-bridge` — test and record result
- [x] 8.6 `kilo agent list` shows `vision-*` subagents; no load errors in
      debug logs
- [x] 8.7 `configuredModelVisionCapable` gate: synthetic vision-capable
      `cfg.model` skips registration (unit-level check or code review)

### Verification results (Kilo 7.4.17)

- **8.1/8.2:** `node scripts/vision-models.mjs` lists image-capable models
  including `minimax-cn-coding-plan/MiniMax-M3`; `--model <provider/model>`
  persists the choice to `~/.config/kilo/vision-model-image.txt` and the
  plugin re-reads it (canonical casing).
- **8.3 Method A (works — recommended):** package added via `file://` path in
  the `plugin` array of `kilo.jsonc`; `kilo agent list` shows 177 `vision-*`
  subagents (incl. `vision-minimax-cn-coding-plan-MiniMax-M3`), no load
  errors.
- **8.4 Method B (works only with full package layout):** copying ONLY
  `dist/index.js` into `~/.config/kilo/plugin/` fails silently — the bundle's
  module-load `readFileSync(join(dataDir, "subagent-body.md"))` (plugin.ts,
  unguarded at the time) throws when sibling data files are absent, and Kilo
  skips the plugin with no error. **Root cause fixed** by a defensive
  try/catch around the `bodyTpl` load with a minimal fallback body (plugin
  still loads in degraded mode). Copying the full layout (dist/index.js +
  SKILL.md + subagent-body.md + scripts/) works — 177 subagents.
- **8.5 Method C (requires publish):** pre-publish, `kilo plugin
  kilo-vision-bridge --global` fails cleanly (404 from registry.npmjs.org,
  exit 1, config untouched). Full verification only possible after
  `npm publish`; command then installs and patches the config.
- **8.6:** `kilo agent list` shows the `vision-*` subagents with no load
  errors in debug logs (verified for Methods A and B).
- **8.7:** `configuredModelVisionCapable` verified by code review plus
  synthetic check: with `cfg.model` set to a catalog vision-capable
  provider/model, the config hook clears `registeredModels` and returns
  before registering any subagent; the skill stays loadable.
