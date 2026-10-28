# Verification Report

Date: 2026-10-28  
Package: `dsh-workbuddy-expert-plus@0.1.1`  
Baseline plan: `docs/superpowers/plans/2026-10-28-workbuddy-dual-mode-implementation.md`

## Automated evidence

| Suite | Command | Result |
|---|---|---|
| Package contract | `node --test test/package-contract.test.js` | PASS |
| Expert build + audit | `node --test test/expert-build.test.js` | PASS (39 approved, 390 blocked) |
| Offline catalog | `node --test test/catalog-offline.test.js` | PASS |
| Unified catalog | `node --test test/catalog-unified.test.js` | PASS: local-source reads, disabled-source fail-closed, bundled hash delegation |
| Agent install | `node --test test/installation.test.js` | PASS |
| Mode compatibility | `node --test test/mode-compat.test.js` | PASS |
| DS-Bot creation | `node --test test/dsbot-creation.test.js` | PASS |
| Bundled routes | `node --test test/bundled-routes.test.js` | PASS |
| Client dual mode | `node --test test/client-dual-mode.test.js test/client-bot-ui.test.js` | PASS |
| Live surface store | `node --test test/client-surface.test.js` | PASS: DS-Bot registrant ownership, Bot-only slot signal, microtask batch, cold start, bot-pending, launcher, composer seat, overlay close-on-leave |
| Lifecycle | `node --test test/plugin-lifecycle.test.js` | PASS; footer subscription disposed with the plugin |
| Pack offline | `node --test test/pack-offline.test.js` | PASS |
| Legacy host smoke | `node scripts/smoke.mjs` | PASS |
| Legacy client smoke | `node scripts/smoke-client.mjs` | PASS |
| Legacy importer smoke | `node scripts/smoke-importer.mjs` | PASS |
| Legacy install smoke | `node scripts/smoke-install.mjs` | PASS |
| Artifact verification | `npm run check:package` | PASS: 231 files, 39 experts, 190 resources; archive re-packed after all fixes |
| Full suite | `node --test test/*.test.js` | PASS: 68 unit/integration tests, 0 failed |

## 2026-10-28 runtime defect fixes

Three defects reported from a live DS-Bot window were reproduced at the
smallest failing boundary, fixed at the root cause, and re-verified:

| Reported symptom | Root cause | Fix | Regression evidence |
|---|---|---|---|
| Bot creation: `catalog.readPrompt is not a function` | `createUnifiedCatalog()` exposed only `stateOf()`, while the mounted market routes call `readPrompt`, `fingerprint`, `find` and `readAsset` | `src/catalog/unified.js` resolves each id through the ENABLED source that owns it: bundled reads keep manifest-hash verification, enabled local reads reach the local scanner, and unknown/disabled ids fail closed. The prompt route now returns the `role.md` byte hash as the edit baseline instead of the aggregate file-list fingerprint | `test/bundled-routes.test.js`: production unified catalog serves prompt/hash 200, and an edited prompt passes the full route→service path; `test/catalog-unified.test.js`: local reads work only when enabled and unknown ids reject |
| Sidebar entry does not follow an Agent/Bot switch until focus/open | Only `storage` and `focus` were observed; a same-window `localStorage.setItem` fires no `storage` event, so the switch stayed invisible until a later focus event | `client/client.js` adds one `createSurfaceStore()` driven by `ctx.slots.subscribe('sidebar.footer.action')`. Only entries owned by DS-Bot (`registrant: 'dyn/ds-bot'`, with `ds-bot` and legacy no-registrant compatibility) count, so another plugin cannot impersonate the footer ids. `bot-account` proves Bot; `bot-return` with storage `agent` proves Agent; `bot-return` with storage `bot` is `bot-pending` and keeps both our entries hidden until the skin settles | `test/client-surface.test.js`: foreign-registrant rejection, microtask transitions, cold start, bot-pending swap, both directions, subscription release; `test/plugin-lifecycle.test.js` asserts the footer cell is the only subscription |
| Bot mode still shows the Agent composer expert picker | The `conversation.input.left` registration was unconditional | New `ComposerExpertSeat` renders `null` in Bot and bot-pending modes and the original `ExpertSelector` in Agent/unknown mode; it subscribes to the same surface store for immediate switching | `test/client-surface.test.js`: Bot hides the picker, bot-pending keeps it hidden, Agent keeps/restores it; deleting the component subscription makes the tests fail |
| Leaving Bot mode leaves the market modal over Agent UI | The overlay gated only on its own open flag; the launcher hid but the independently mounted `shell.overlay` entry stayed open | `BotMarketOverlayHost` now takes the surface store, renders only when open AND Bot mode is current, and closes the module flag on any non-Bot transition so a later Bot visit never resurrects it | `test/client-surface.test.js`: open in Bot → switch to Agent → dialog unmounts; switching back does not reopen it; an explicit launcher click opens it again |

Important limitation: the locally installed profile
`~/.dsh/profiles/ds-bot` was found to contain an **older package layout**
(`resources/catalog.json`, `src/market/*`, `src/integrations/*`) that is not the
current repository tree. The automated evidence above is for the current
source and the freshly packed `.tgz`; the live profile must be reinstalled from
`build/dsh-workbuddy-expert-plus-0.1.1.tgz` before the three screenshots can be
re-tested against this build.

## Artifact

- `.tgz`: `build/dsh-workbuddy-expert-plus-0.1.1.tgz`
- Manifest experts: 39
- Resource files: 190
- Contents report: `build/reports/packaged-contents.json`
- All manifest hashes verified after extraction.
- The archive's `src/importer/bundled-routes.js` matches the working tree and
  carries the prompt-baseline fix; archive `client/client.js` and
  `src/catalog/unified.js` carry the surface and source-routing fixes.

## Not verified / release gates

- E01–E07, E10, E14, E15, E16 require physical DSH Desktop/Web and DS-Bot
  standalone hosts. No live screenshots, videos or host logs are available in
  this environment; these rows are **not** claimed as passed.
- 390 of 429 indexed experts lack prompt-level redistribution evidence. The
  full-catalog offline goal is therefore **blocked by licensing**, not by code.
- No claim is made that DS-Bot standalone currently permits third-party plugin
  installation until that is tested on the actual app version.

## Final command log

Final run: `node --test test/*.test.js` → 68/68 passed; all four legacy smoke
scripts passed; `npm run check:package` → 231 files, 39 experts, 190 resources,
every manifest hash verified after extraction; the `.tgz` was re-packed after
the prompt-baseline, source-routing, registrant-ownership, and overlay-lifecycle
fixes, and the archive's client/unified/route files match this HEAD.
