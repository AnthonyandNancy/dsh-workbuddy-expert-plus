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

## 2026-10-30 — DS Bot 0.2.4 Bot 模式入口消失与切换实时性

### 根因

| 观测 | 证据 |
|---|---|
| DS Bot 0.2.3 | `TeamSidebar` 直接渲染在 `sidebar.workspaces` 的 shell 区域；插件的 `sidebar.footer.action` 入口可见 |
| DS Bot 0.2.4 | 新增 `LeftColumn`，把可见侧栏 `createPortal(..., document.body)`；`sidebar.js` 注释明确 “The foot stands in for the shell's hidden footer”，Bot 视图的 footer 只渲染 `AccountLauncher` |
| WorkBuddy 插件 | 入口只注册在 `sidebar.footer.action`；0.2.4 Bot 模式下该 slot 仍存在，但宿主落在隐藏的 shell footer，因此入口从可见 DOM 消失。仅改挂 `shell.overlay` 仍不够：DSH overlay 层 z-index 20，低于 0.2.4 left column 的 z-index 25，入口能渲染但点不到 |
| 模式切换 | 同一 `createSurfaceStore()` 仍能实时得到 `bot`/`agent`，但入口所在位置本身在 Bot 模式下不可见，用户感知为“切换没有实时响应” |

### 修复

- `client/client.js` 新增 `BotMarketLauncherHost`，仅当 `surface === 'bot'` 时渲染，并挂在公开 `shell.overlay` seat。
- 该 host 使用 `react-dom` 的 `createPortal(..., document.body)`，外层 `.wbx-launcher-portal-host` 固定 z-index 30：高于 DS-Bot left column 的 25，低于其菜单/弹层的 60。没有 `react-dom` 时安全降级为普通面板。
- `shell.overlay` 注册改为同时渲染 `BotMarketLauncherHost` 与既有 `BotMarketOverlayHost`，共享同一 surface store 与模块级 open flag。
- Agent 模式继续使用原 `sidebar.footer.action` 入口；两处入口不会在 `bot-pending` 或 Agent 态同时出现。
- 新增样式 `.wbx-launcher-host` 为 232×32 的小面板（窄屏 36×36），`.wbx-overlay-stack` 保持 `pointer-events:none`，只让入口本身 `auto`，不形成全屏命中层。
- 不接管 `sidebar.workspaces`、不修改 DS Bot 源码/私有 localStorage、不注入宿主 DOM。

### 自动化证据

| 检查 | 命令 | 结果 |
|---|---|---|
| 定向 surface/lifecycle | `node --test test/client-surface.test.js test/plugin-lifecycle.test.js` | PASS：21 tests |
| 全量 unit/integration | `node --test test/*.test.js` | PASS：96 tests, 0 failed |
| 完整项目链 | `npm test` | PASS：96 tests + 4 smoke scripts |
| 真实 0.2.4 portal/hit-test | Playwright on DSH Web + packaged `ds-bot@0.2.4` | PASS：body portal、z-index 30、232×32、`hitOwns=true` |
| 打包完整性 | `npm run check:package` | PASS：5,987 files, 429 experts, 5,946 resources |

### 宿主层级视觉验证（不是整机验收）

- 生成页：`output/playwright/bot-mode-overlay-host.html`。
- 截图：`output/playwright/bot-mode-overlay-host.png`。
- 该页使用真实 `MARKET_CSS`，并复刻 `shell.overlay` 的 `pointer-events:none` 容器与 0.2.4 `LeftColumn` 侧栏形态。
- Playwright 实测：入口 `232×32`、`label` 宽 168px、命中自身；对话中心 `elementFromPoint` 仍为 `chat`，说明没有全屏遮挡。

### 真实 DS Bot 0.2.4 窗口验收

为避免干扰用户正在运行的窗口，使用 0.2.4 包内自带的 DSH `0.2.1-rc.4` CLI 在隔离目录启动：

- 临时 `DSH_HOME`：`.tmp-review/e2e-bot024/data`
- 临时 profile：`profiles/web`，bundles 为 `dsh-base + dsh-web-app + ds-bot + dsh-workbuddy-expert-plus`
- `ds-bot` 链接到应用 asar 内的真实 `0.2.4` 包；插件链接到当前工作区源码
- 端口 `4319`，使用日志中的一次性 token 打开真实页面

实测结果：

| 场景 | 证据 |
|---|---|
| Bot 模式入口 | `surface=bot`；`.wbx-launcher-portal-host` 的父节点是 `document.body`，`z-index=30`；入口 `232×32`；`elementFromPoint` 命中 `.wbx-launcher` 内部，`hitOwns=true` |
| 打开市场 | 点击入口后真实市场出现 429 张专家卡片，每张都有「创建 Bot」按钮 |
| 切到 Agent | `surface=agent`；`.wbx-launcher` 数量为 0；`.bt-leftcol` 消失；composer 出现「专家」按钮（`expertSeat=1`） |
| 切回 Bot | 同一窗口立即出现 2 个入口（portal + footer），无需刷新；`surface=bot`、portal 存在 |
| 冷启动刷新 | 刷新后仍为 `surface=bot`、portal 存在、2 个入口 |
| 截图 | `output/playwright/bot-mode-real-024.png` |

### 结论

根因（隐藏 shell footer + overlay z-index 低于 DS-Bot left column）已修复，并在真实 DSH `0.2.1-rc.4` + DS Bot `0.2.4` 页面中完成点击级验收。自动化 96 tests + 4 smoke 全通过。
