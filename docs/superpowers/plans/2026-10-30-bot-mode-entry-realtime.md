# DS Bot 0.2.4 Bot 模式入口消失与模式切换实时响应修复计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DSH `0.2.1-rc.4` + DS Bot `0.2.4` 下恢复 Bot 模式的 WorkBuddy 专家入口，并让 Agent/Bot 模式切换在同一窗口实时改变入口和 composer 归属。

**Architecture:** 保留 Agent 模式的 `sidebar.footer.action` 入口；新增一个仅 Bot 模式渲染的 `shell.overlay` launcher host，用插件自己的 surface store 在两种宿主布局之间切换。DS Bot 0.2.4 把可见侧栏 portal 到 body，并用 `LeftColumn` 自绘 footer；shell footer 被隐藏，因此原入口在 Bot 模式不可见。新 host 不接管 `sidebar.workspaces`，不修改 DS Bot 源码或私有存储。

**Tech Stack:** Node.js >=20 ESM、`node:test`、零构建 DSH 客户端 bundle（`window.__ModuleLoader__.load`）、React `createElement`、DSH slot contracts、DSH CSS alias tokens。

## 根因证据

| 观测 | 证据 |
|---|---|
| DSH 版本 | `dsh-client-ui-sidebar@0.1.0-rc.6` 源码在 `sidebar.footer.action` 只调用 `renderSlot(..., { wide })`；slot 本身可见性由 shell footer 决定 |
| DS Bot 0.2.3 | `TeamSidebar` 直接渲染在 `sidebar.workspaces` 的 shell 区域内，shell footer 仍可见 |
| DS Bot 0.2.4 | 新增 `LeftColumn`，`createPortal(..., document.body)` 自绘可见侧栏；注释写明 “The foot stands in for the shell's hidden footer”；footer 只渲染 `AccountLauncher` |
| WorkBuddy 插件 | 入口只注册在 `sidebar.footer.action`，因此 0.2.4 Bot 模式下 entry 留在 slot ledger，但 DOM 落在隐藏的 shell footer |
| 实时切换 | `createSurfaceStore()` 由 `bot-account`/`bot-plus` 与 storage 驱动；但入口只在 footer，模式切换后位置本身不可见，表现为“没有实时响应” |

## Global Constraints

- 只改 `packages/dsh-workbuddy-expert-plus/client/client.js` 与测试/文档；不改 DS-Bot、DSH 安装包、用户 `~/.dsh` 数据。
- 不注入宿主 DOM、不使用 `MutationObserver`、不写 `localStorage['ds-bot:*']`。
- 不接管 `sidebar.workspaces`，不替换 `TeamSidebar`。
- Bot 模式新增入口只挂在公开 `shell.overlay` slot；Agent 模式继续使用 `sidebar.footer.action`。
- 所有新增颜色使用 DSH alias token，并带 fallback；不新增硬编码亮/暗值。
- 每个生产改动前先写失败测试并观察失败；提交前 `git status --short` 只包含预期文件。
- 不 push、不新建分支；计划直接落在当前 `main`。

---

### Task 1: 用失败测试锁定 Bot 模式 overlay 入口契约

**Files:**
- Modify: `test/client-surface.test.js`
- Modify: `test/plugin-lifecycle.test.js`
- Test: `test/client-surface.test.js`, `test/plugin-lifecycle.test.js`

**Interfaces:**
- Consumes: 现有 `surfaceHarness()`、`renderComponent()`、`module.createSurfaceStore()`、`module.BotMarketLauncher`。
- Produces: `BotMarketLauncherHost`（待实现）必须满足：Bot 模式渲染一个 `div.wbx-launcher-host`，内部渲染 `BotMarketLauncher`；Agent/unknown/bot-pending 返回 `null`；不产生全屏可交互遮罩。

- [ ] **Step 1: 写失败测试（surface）**

在 `test/client-surface.test.js` 末尾追加：

```js
test('the Bot-mode overlay host renders the launcher only on the Bot surface', async () => {
  const app = surfaceHarness(agentOnly, 'agent')
  const host = renderComponent(module.BotMarketLauncherHost, {
    surfaceStore: app.store,
    t: (key) => key,
    onOpen() {},
    wide: true,
  })
  assert.equal(host.tree(), null, 'Agent mode must not mount the overlay launcher')
  assert.equal(module.BotMarketLauncherHost.length, 1,
    'the host is a component, not a plain function')

  await app.transition(botOnly)
  await host.flush()
  const tree = host.tree()
  assert.equal(tree?.props.className, 'wbx-launcher-host')
  assert.equal(tree?.props['data-screen'], 'bot')
  assert.equal(tree?.children[0]?.type, module.BotMarketLauncher,
    'the host delegates to the shared launcher so both entrances stay identical')
})
```

- [ ] **Step 2: 写失败测试（lifecycle）**

在 `test/plugin-lifecycle.test.js` 末尾追加：

```js
test('the Bot-mode launcher has an overlay host and no full-screen hit target', () => {
  const app = bootClient({ surface: 'bot' })
  const dispose = app.module.apply(app.ctx)
  const OverlaySeat = app.rendered.get('shell.overlay')
  assert.ok(OverlaySeat, 'the shell.overlay registration exists')

  const overlayTree = OverlaySeat({})
  assert.equal(overlayTree.type, app.module.BotMarketOverlayHost,
    'the overlay seat renders the overlay host, not only the modal host')
  assert.match(source, /className: 'wbx-launcher-host'/)
  assert.doesNotMatch(source, /className: 'wbx-launcher-shield'/,
    'the launcher host must not introduce a full-screen shield')

  dispose()
})
```

- [ ] **Step 3: 运行测试并确认失败**

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-surface.test.js test/plugin-lifecycle.test.js
```

Expected: FAIL，`module.BotMarketLauncherHost is not a function` 或 `overlayTree.type` 不等于 `BotMarketLauncherHost`。确认失败来自缺功能，不是测试语法错误。

- [ ] **Step 4: 提交失败测试**

```bash
cd packages/dsh-workbuddy-expert-plus
git add test/client-surface.test.js test/plugin-lifecycle.test.js
git commit -m "test: lock the Bot-mode overlay launcher contract"
```

---

### Task 2: 实现 Bot 模式 overlay launcher host 并接入 overlay seat

**Files:**
- Modify: `client/client.js`（`BotMarketLauncher` 后新增 `BotMarketLauncherHost`；`BotMarketOverlayHost` 或 overlay 注册处接入）
- Test: `test/client-surface.test.js`, `test/plugin-lifecycle.test.js`

**Interfaces:**
- Consumes: `surfaceStore.get()/subscribe()`、`BotMarketLauncher(props)`、`openBotMarket()`。
- Produces:
  - `BotMarketLauncherHost(props)`：`props.surfaceStore`、`props.t`、`props.onOpen`、`props.wide`；Bot 模式返回 `el('div', { className: 'wbx-launcher-host', 'data-screen': 'bot' }, el(BotMarketLauncher, ...))`，其他模式返回 `null`。
  - overlay seat 同时渲染 `BotMarketLauncherHost` 与现有 `BotMarketOverlayHost`；两者共享 `surfaceStore` 和 `openBotMarket`。

- [ ] **Step 1: 实现 host（纯展示，不含 DOM 写入）**

在 `BotMarketLauncher` 之后加入：

```js
/**
 * Bot mode's second entrance. DS-Bot 0.2.4 portals its visible sidebar to
 * document.body and hides the shell footer, so a `sidebar.footer.action`
 * registration is still in the ledger but no longer in the visible tree.
 * This host rides the public `shell.overlay` seat instead, and renders only
 * while the shared surface store says Bot is current.
 */
function BotMarketLauncherHost (props) {
  var store = props.surfaceStore
  var surfaceState = React.useState(store !== undefined && store !== null ? store.get() : 'unknown')
  var surface = surfaceState[0]
  var setSurface = surfaceState[1]
  React.useEffect(function () {
    if (store === undefined || store === null || typeof store.subscribe !== 'function') return undefined
    setSurface(store.get())
    return store.subscribe(setSurface)
  }, [store])
  if (surface !== 'bot') return null
  return el('div', { className: 'wbx-launcher-host', 'data-screen': 'bot' },
    el(BotMarketLauncher, {
      t: props.t,
      surfaceStore: store,
      wide: props.wide,
      onOpen: props.onOpen
    }))
}

module.exports.BotMarketLauncherHost = BotMarketLauncherHost
```

- [ ] **Step 2: 把 host 接到 overlay seat**

在 `apply()` 的 `shell.overlay` 注册组件里，返回一个 Fragment（若现有 bundle 无 Fragment，则返回一个 `div.wbx-overlay-stack` 包裹）：

```js
return el('div', { className: 'wbx-overlay-stack' },
  el(BotMarketLauncherHost, {
    t: t,
    surfaceStore: surfaceStore,
    wide: false,
    onOpen: function () { openBotMarket() }
  }),
  el(BotMarketOverlayHost, {
    t: t,
    localeId: getLocale(),
    surfaceStore: surfaceStore
  }))
```

- [ ] **Step 3: 加样式：只占固定小区域，不创建全屏命中层**

在 `MARKET_CSS` 的 launcher 段落追加：

```css
.wbx-launcher-host { position: fixed; left: 12px; bottom: 64px; z-index: 30;
  width: 232px; max-width: calc(100vw - 24px); pointer-events: auto; }
.wbx-launcher-host .wbx-launcher { width: 100%; }
[data-left="rail"] ~ .wbx-launcher-host { width: 36px; }
@media (max-width: 900px) { .wbx-launcher-host { width: 36px; } }
```

Note: `.wbx-launcher-host` must not be `inset: 0`; it must not cover the conversation. If `data-left` sibling selector is not reliable in the overlay layer, use `width: 36px` only for a documented narrow viewport and leave the wide form otherwise.

- [ ] **Step 4: 运行测试并确认通过**

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-surface.test.js test/plugin-lifecycle.test.js
```

Expected: PASS，且 `BotMarketLauncherHost` 在 Agent 返回 null、Bot 返回 host；overlay seat 同时包含两种 host。

- [ ] **Step 5: 提交**

```bash
cd packages/dsh-workbuddy-expert-plus
git add client/client.js test/client-surface.test.js test/plugin-lifecycle.test.js
git commit -m "fix: mount the Bot-mode market launcher through shell overlay"
```

---

### Task 3: 验证模式切换实时性，不让 Bot 切换期间出现双入口或闪回

**Files:**
- Modify: `client/client.js`（如需在 `createSurfaceStore` 暴露稳定的 settled 值）
- Test: `test/client-surface.test.js`

**Interfaces:**
- Consumes: `surfaceStore` 的 `get/subscribe`，`BotMarketLauncherHost`、`BotMarketLauncher`。
- Produces: 单个 `bot` 状态下 footer 与 overlay 入口不会同时可见；`bot-pending` 两者都隐藏；切回 `agent` 后 overlay 隐藏。

- [ ] **Step 1: 写失败测试**

追加：

```js
test('the footer and overlay entrances never show together during a skin switch', async () => {
  const bot = surfaceHarness(botOnly, 'agent')
  const footer = renderComponent(module.BotMarketLauncher, {
    t: (key) => key,
    surfaceStore: bot.store,
    onOpen() {},
  })
  const overlay = renderComponent(module.BotMarketLauncherHost, {
    t: (key) => key,
    surfaceStore: bot.store,
    onOpen() {},
    wide: false,
  })
  assert.ok(footer.tree(), 'footer launcher exists on the Bot surface')
  assert.ok(overlay.tree(), 'overlay launcher exists on the Bot surface')

  // An Agent switch withdraws the Bot-only cell first; both entrances must
  // disappear before the Agent footer is installed.
  await bot.transition(agentOnly)
  await bot.storageTransition('agent')
  await footer.flush()
  await overlay.flush()
  assert.equal(footer.tree(), null)
  assert.equal(overlay.tree(), null, 'no overlay launcher on the Agent surface')

  await bot.transition(botOnly)
  await footer.flush()
  await overlay.flush()
  assert.ok(overlay.tree(), 'the overlay launcher returns immediately on Bot')
})
```

- [ ] **Step 2: 运行测试并确认失败**

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-surface.test.js -t "footer and overlay entrances"
```

Expected: FAIL，直到 overlay host 存在并跟随 store。

- [ ] **Step 3: 只在必要时修 surface store**

如果 `bot-pending` 状态下 overlay 仍闪现，修改 `BotMarketLauncherHost` 的判定为 `surface !== 'bot'` 时一律返回 `null`（已是本计划写法）；不要在 `createSurfaceStore` 里写 DS-Bot 私有状态。保留 `settled` 逻辑，避免切换窗口闪回。

- [ ] **Step 4: 运行全套 surface 测试**

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-surface.test.js test/client-bot-ui.test.js test/plugin-lifecycle.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
cd packages/dsh-workbuddy-expert-plus
git add client/client.js test/client-surface.test.js test/plugin-lifecycle.test.js
git commit -m "test: cover the Bot launcher across live surface transitions"
```

---

### Task 4: 全量回归、打包与实机安装验证

**Files:**
- Modify: `docs/verification-report.md`（追加根因、修复、命令和实机结论）
- Test: `npm test`, `npm run check:package`

- [ ] **Step 1: 跑客户端与生命周期定向测试**

```bash
cd packages/dsh-workbuddy-expert-plus
node --test test/client-surface.test.js test/client-bot-ui.test.js test/plugin-lifecycle.test.js
```

Expected: 0 failed。

- [ ] **Step 2: 跑全量测试**

```bash
cd packages/dsh-workbuddy-expert-plus
npm test
```

Expected: 全部 unit/integration + smoke 通过，0 failed。

- [ ] **Step 3: 打包完整性**

```bash
cd packages/dsh-workbuddy-expert-plus
npm run check:package
```

Expected: `ok: true`，tarball 内 `client/client.js` 含 `wbx-launcher-host`，且 `BotMarketLauncherHost` 可被模块加载。

- [ ] **Step 4: 安装到运行中的 DS Bot 0.2.4 profile**

当前实机 profile 为：

```text
E:\DSHbot\data\profiles\ds-bot
```

该 profile 的 `dsh-workbuddy-expert-plus` 已是 `link:D:\code\ai\dsh-workbuddy-expert\packages\dsh-workbuddy-expert-plus`。修改源码后重启 DS Bot 即可加载新 bundle；不要直接覆盖 `node_modules` 下的文件。

- [ ] **Step 5: 实机验证**

在 DS Bot 0.2.4 中：

1. 切到 Bot 模式，确认左侧栏底部出现「WorkBuddy 专家」入口；
2. 打开市场，确认卡片、创建 Bot 表单与模型选择可用；
3. 切到 Agent 模式，确认入口消失、Agent composer 专家选择器恢复；
4. 切回 Bot 模式，确认入口在同一窗口立即出现，无需刷新；
5. 折叠/展开侧栏，确认入口在 rail 下缩小为图标且可点击。

将实际观察写入 `docs/verification-report.md`，并附截图路径（若可采集）。

- [ ] **Step 6: 提交验证记录**

```bash
cd packages/dsh-workbuddy-expert-plus
git add docs/verification-report.md
git commit -m "docs: record the DS Bot 0.2.4 launcher verification"
```

---

## Self-Review

- **Spec coverage:** 根因（Task 1 证据）、方案（Task 2 host + overlay）、切换实时性（Task 3）、实机验证（Task 4）均有对应任务。
- **Placeholder scan:** 无 TBD/TODO；所有生产步骤给出可粘贴代码或明确判定条件。
- **Type consistency:** 统一使用 `BotMarketLauncherHost`、`wbx-launcher-host`、`surfaceStore`、`wide`；未引入与现有 `BotMarketLauncher` 冲突的签名。
- **Constraint check:** 不接管 `sidebar.workspaces`、不注入宿主 DOM、不写 DS-Bot storage、不修改 0.2.4 源码。
