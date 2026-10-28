# Verification Report

Date: 2026-10-28  
Package: `dsh-workbuddy-expert-plus@0.1.0`  
Baseline plan: `docs/superpowers/plans/2026-10-28-workbuddy-dual-mode-implementation.md`

## Automated evidence

| Suite | Command | Result |
|---|---|---|
| Package contract | `node --test test/package-contract.test.js` | PASS |
| Expert build + audit | `node --test test/expert-build.test.js` | PASS (39 approved, 390 blocked) |
| Offline catalog | `node --test test/catalog-offline.test.js` | PASS |
| Agent install | `node --test test/installation.test.js` | PASS |
| Mode compatibility | `node --test test/mode-compat.test.js` | PASS |
| DS-Bot creation | `node --test test/dsbot-creation.test.js` | PASS |
| Bundled routes | `node --test test/bundled-routes.test.js` | PASS |
| Client dual mode | `node --test test/client-dual-mode.test.js test/client-bot-ui.test.js` | PASS |
| Live surface store | `node --test test/client-surface.test.js` | PASS (Bot-only slot signal, transition notification, launcher, composer seat) |
| Lifecycle | `node --test test/plugin-lifecycle.test.js` | PASS; footer subscription disposed with the plugin |
| Pack offline | `node --test test/pack-offline.test.js` | PASS |
| Legacy host smoke | `node scripts/smoke.mjs` | PASS |
| Legacy client smoke | `node scripts/smoke-client.mjs` | PASS |
| Legacy importer smoke | `node scripts/smoke-importer.mjs` | PASS |
| Legacy install smoke | `node scripts/smoke-install.mjs` | PASS |
| Artifact verification | `npm run check:package` | PASS: 231 files, 39 experts, 190 resources |
| Full suite | `node --test test/*.test.js` | PASS: 58 unit/integration tests, 0 failed |

## 2026-10-28 runtime defect fixes

Three defects reported from a live DS-Bot window were reproduced at the
smallest failing boundary, fixed at the root cause, and re-verified:

| Reported symptom | Root cause | Fix | Regression evidence |
|---|---|---|---|
| Bot creation: `catalog.readPrompt is not a function` | `createUnifiedCatalog()` exposed only `stateOf()`, while the mounted market routes call `readPrompt`, `fingerprint`, `find` and `readAsset` | `src/catalog/unified.js` forwards every read to the bundled catalog, preserving manifest-hash verification; an absent implementation throws instead of returning an empty prompt | `test/bundled-routes.test.js`: the production unified catalog serves a non-empty prompt with status 200; forwarded reads match direct bundled reads; an unknown id rejects |
| Sidebar entry does not follow an Agent/Bot switch until focus/open | Only `storage` and `focus` were observed; a same-window `localStorage.setItem` fires no `storage` event, so the switch stayed invisible until a later focus event | `client/client.js` adds one `createSurfaceStore()` driven by `ctx.slots.subscribe('sidebar.footer.action')`. DS-Bot's Bot-only `bot-account` entry proves Bot mode; `bot-return` alone proves Agent mode; storage/focus/visibility stay fallbacks, and residual storage alone never creates a Bot surface | `test/client-surface.test.js`: a transition notifies synchronously, the launcher appears/disappears in both directions, and the subscription is released; `test/plugin-lifecycle.test.js` asserts the footer cell is the only subscription |
| Bot mode still shows the Agent composer expert picker | The `conversation.input.left` registration was unconditional | New `ComposerExpertSeat` renders `null` in Bot mode and the original `ExpertSelector` in Agent/unknown mode; it subscribes to the same surface store for immediate switching | `test/client-surface.test.js`: Bot hides the picker, Agent keeps it, switching back restores it; client smoke asserts both directions |

Important limitation: the locally installed profile
`~/.dsh/profiles/ds-bot` was found to contain an **older package layout**
(`resources/catalog.json`, `src/market/*`, `src/integrations/*`) that is not the
current repository tree. The automated evidence above is for the current
source and the freshly packed `.tgz`; the live profile must be reinstalled from
`build/dsh-workbuddy-expert-plus-0.1.0.tgz` before the three screenshots can be
re-tested against this build.

## Artifact

- `.tgz`: `build/dsh-workbuddy-expert-plus-0.1.0.tgz`
- Manifest experts: 39
- Resource files: 190
- Contents report: `build/reports/packaged-contents.json`
- All manifest hashes verified after extraction.

## Not verified / release gates

- E01–E07, E10, E14, E15, E16 require physical DSH Desktop/Web and DS-Bot
  standalone hosts. No live screenshots, videos or host logs are available in
  this environment; these rows are **not** claimed as passed.
- 390 of 429 indexed experts lack prompt-level redistribution evidence. The
  full-catalog offline goal is therefore **blocked by licensing**, not by code.
- No claim is made that DS-Bot standalone currently permits third-party plugin
  installation until that is tested on the actual app version.

## Final command log

Final run: `node --test test/*.test.js` → 58/58 passed; all four legacy smoke
scripts passed; `npm run check:package` → 231 files, 39 experts, 190 resources,
every manifest hash verified after extraction.
