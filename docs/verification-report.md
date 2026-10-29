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

Important limitation: the standalone DS-Bot desktop app loads its own profile
at `E:\DSHbot\data\profiles\ds-bot`, distinct from `~/.dsh/profiles/ds-bot`.
Both profiles were upgraded to `0.1.1` by installing
`build/dsh-workbuddy-expert-plus-0.1.1.tgz`; the standalone app's profile now
lists `dsh-workbuddy-expert-plus` 0.1.1 in its bundle list and lockfile. The
automated evidence above is for this source and this `.tgz`.

What is still missing is the visual re-test: the standalone app's host requires
its launch token (`GET /connect?token=…`), so the in-app window cannot be driven
from an external browser session, and after restarting the app its process
exited before a window could be inspected here. Open the app yourself and
verify the three screenshots against 0.1.1.

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

## 2026-10-28 v0.2.1 market category, Chinese title and Bot card parity

Package: `dsh-workbuddy-expert-plus@0.2.1`  
Branch: `feat/market-categories-cn-titles`  
Plan: `docs/superpowers/plans/2026-10-28-market-categories-cn-titles.md`

### Root cause and fix

| Reported symptom | Root cause | Fix | Regression evidence |
|---|---|---|---|
| Agent market shows only “未分类 429” | `/market/state` bundled cards carry `categoryId`, while `categoryOf()` read only the legacy local-scan field `category`; `KNOWN_CATEGORY_LABELS` also covered only 6 of the 15 original categories | `categoryOf()` now prefers `categoryId` and falls back to `category`; the label table was restored from `expert_center.json` to all 15 original Chinese names | `test/client-market-cards.test.js`: 15 chips, 429 cards distributed, zero uncategorized, 39 finance cards, category × search filtering |
| Expert titles show English machine ids | `localeNameOf()` read only `zhName` / `name`, neither of which exists on bundled cards (`displayName` does) | Chinese title selection now prefers whichever human-facing field carries Han characters (`displayName` → `zhName` → `profession` → `name`); pure-English brand names such as `CloudQ` fall back to their Chinese profession instead of the id. Search indexes the same fields | `test/client-market-cards.test.js`: every one of the 429 cards yields a Chinese title; title and profession searches hit the expected card |
| Bot market cards differ from Agent cards | `BotMarketOverlay` rendered its own inline `wbx-card` markup with no avatar, badges, category row or shared action corner | `ExpertCard` now accepts an injected primary action and status mark. Bot reuses it with “创建 Bot / 再次创建”, carries `avatarFile` to the shared avatar, and reuses the Agent category-chip helpers. Agent keeps its original install/update/uninstall confirm row | `test/client-bot-ui.test.js`: expanded render asserts avatar, Chinese title, id, description, category badge, category chips and only create actions; no `installBtn` appears |

### Automated evidence

| Suite | Command | Result |
|---|---|---|
| Unit + integration | `node --test test/*.test.js` | PASS: 86 tests, 0 failed |
| Complete project chain | `npm test` | PASS: 86 tests + `smoke`, `smoke-client`, `smoke-importer`, `smoke-install` |
| Artifact verification | `npm run check:package` | PASS: 5,987 files, 429 experts, 5,946 resources, every manifest hash verified after extraction |
| Installed profile catalog | Node read of `E:\DSHbot\data\profiles\ds-bot\node_modules\dsh-workbuddy-expert-plus` | PASS: version `0.2.1`, 429 experts, `ready: 429`, `blocked: 0`, 15 non-empty categories |

### Real-device evidence (DS-Bot 0.2.10 / DSH 0.2.1-rc.2)

Host: real `app/src/host.mjs` with `DSH_HOME=E:\DSHbot\data` and profile
`E:\DSHbot\data\profiles\ds-bot`; browser at `http://127.0.0.1:4391/`.

Agent mode (`设置 → WorkBuddy 专家`):

- Category row: 16 buttons = `全部分类` + the original 15 categories.
- Cards: 429; first title `40-20 外卖券`; first id `meituan-living-assistant-meituan-living-assistant`.
- First card has an avatar and the `销售商务` category badge.
- Census: `专家 429 · 内置 429 · 本机 0 · 来源插件 1 · 分类 15`.
- Clicking `金融投资` narrows the grid to 39 finance cards with Chinese titles.
- Screenshot: `docs/images/agent-market-categories.png`.

Bot mode (`侧边 WorkBuddy 专家`):

- Category row: 16 buttons with the same 15 categories and live counts.
- Cards: 429; Chinese titles (`40-20 外卖券`, `阿联酋公共事务专家`, `安迪`, …).
- Each card has avatar, id, description and category badge; grid is the same two-column card layout as Agent.
- Card actions: only `创建 Bot` / `再次创建`; zero install/uninstall buttons.
- Hovering a card reveals its `创建 Bot` corner (`opacity: 1`, `pointer-events: auto`).
- Opening the first card fills the form with `白必得` / `投行交易助理`, a 5,688-character prompt and the live model selector.
- Clicking `金融投资` narrows the grid to 39 cards.
- Screenshot: `docs/images/bot-market-cards.png`.

### Artifact v0.2.1

- `.tgz`: `build/dsh-workbuddy-expert-plus-0.2.1.tgz`
- SHA-256: `29f48ce7b13bc64bcfdd59bb5a6ca701557bdb95ddabbc166e23b6b7e829aa6e`
- Files: 5,987
- Experts: 429 (`ready: 429`, `blocked: 0`)
- Resources: 5,946
- Installed into `E:\DSHbot\data\profiles\ds-bot` and exercised on the real host.

## 2026-10-29 — Bot 侧栏入口方案 B（描边胶囊）

- 变更：`client/client.js` 的 `BotMarketLauncher` 改为 32px 描边胶囊（图标 + `nav` 文案 + 箭头），并用 `sidebar.footer.action` 的 `wide` owner prop 驱动 `data-wide`；`data-wide="false"` 收为 36×36 纯图标。颜色全部来自 DSH token（悬停阴影走 `--dsw-shadow-lv1`），亮/暗与第三方主题切换无需重渲染。
- 契约测试：`node --test test/client-bot-ui.test.js test/client-surface.test.js test/plugin-lifecycle.test.js` — 全部通过；新增入口 DOM 契约、CSS token/折叠契约、以及 slot 注册处的 `wide` 转发断言。`wide` 透传做过变异验证：删除转发后新断言失败，恢复后通过。
- 全量回归：`npm test` — 90 tests, 0 fail；`smoke`、`smoke-client`、`smoke-importer`、`smoke-install` 四条全部通过。
- 打包完整性：`npm run check:package` — `"ok": true`，`files` = 5987，`experts` = 429，`resources` = 5946；tarball 内 `client/client.js` 含 `wbx-launcher-caret` 与 `--dsw-shadow-lv1`。
- 实机安装：实际运行的 DS-Bot 使用 `E:\DSHbot\data\profiles\ds-bot`（不是文档先前记录的 `C:\Users\guojl\.dsh\profiles\ds-bot`），该 profile 的插件是 GitHub 源安装的 0.2.1，不是本机 tgz。已将本次 `client/client.js` 同步到该 profile 的 `node_modules/dsh-workbuddy-expert-plus/client/client.js`，`node --check` 通过。
- 实机确认：用户重启 DS-Bot 后在真实 Bot 侧栏人工核对，展开态（描边胶囊 + 图标 + 文案 + 箭头）、折叠态（36×36 纯图标）与亮/暗主题均显示正常，反馈"没问题"。
- 视觉证据：`output/playwright/launcher-final.png`（真实 `MARKET_CSS` 渲染：浅色展开、深色展开、折叠 36×36）；生成页 `output/playwright/launcher-final.html`；方案对比页 `output/playwright/launcher-options.html`。
- 已知限制：折叠态依赖宿主向 footer entry 传 `wide`，若未来不再传，入口按展开态渲染（不会变成空图标）。
