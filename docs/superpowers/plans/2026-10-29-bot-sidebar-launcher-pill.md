# Bot 侧栏「WorkBuddy 专家」描边胶囊入口 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Bot 模式侧栏底部的「WorkBuddy 专家」由纯文字改成方案 B 的描边胶囊入口，并在折叠态保留可识别的图标。

**Architecture:** 只改插件自己的零构建客户端 bundle `client/client.js`：扩展 `BotMarketLauncher`，从 `sidebar.footer.action` 的 owner props 接收 `wide`，渲染图标/标签/箭头三个稳定子节点，同时给按钮挂 `data-wide`；`.wbx-launcher` 的样式全部改用 DSH 主题 token 并为旧宿主保留 rgba fallback。折叠态由 CSS 依据 `data-wide="false"` 收成 36×36 图标按钮，不新增宿主 API、不改 DS-Bot、不注入全局样式。测试走现有 `test/client-bot-ui.test.js` 的源码契约断言与 `test/client-surface.test.js` 的真实渲染夹具，最后用 Playwright 以真实 token 渲染浅色/深色/折叠三态并截图核对。

**Tech Stack:** Node.js >=20 ESM、`node:test`、零构建 DSH 客户端 bundle（`window.__ModuleLoader__.load`）、React 18 契约（`createElement`）、DSH 主题 CSS 变量、Playwright CLI（视觉验收）。

## Global Constraints

- 只修改 `packages/dsh-workbuddy-expert-plus/client/client.js` 与其测试；不新增运行时依赖、不新增构建步骤、不改 `package.json` 版本。
- 不修改 DS-Bot 私有 localStorage（禁止 `localStorage.setItem('ds-bot:…')`），不做宿主 DOM 注入（禁止新增 `MutationObserver`），不写死亮/暗色值。
- 所有新增颜色必须走 DSH token，并带与主题无关的 fallback：`--dsw-alias-bg-layer-2`、`--dsw-alias-border-l2`、`--dsw-alias-border-l3`、`--dsw-alias-label-primary`、`--dsw-alias-label-secondary`、`--dsw-interactive-bg-hover`、`--dsw-alias-brand-primary`。
- 入口文案继续使用既有 locale key `nav`（`WorkBuddy 专家` / `WorkBuddy Experts`），不为视觉改动新增文案 key。
- 折叠态必须仅由 slot owner props 的 `wide` 驱动；`wide` 缺省视为展开，未知宿主不会把入口压成空图标。
- 每个生产代码改动前必须先写失败测试并观察失败；提交信息使用 Conventional Commits，提交前 `git status --short` 必须只剩本任务的预期文件。
- 包内目前是 `main` 分支且工作区干净；本计划的提交直接落在 `main`，不新建分支、不 push。

---

### Task 1: 用失败测试锁定方案 B 的入口契约

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/test/client-bot-ui.test.js`
- Test: `packages/dsh-workbuddy-expert-plus/test/client-bot-ui.test.js`

**Interfaces:**
- Consumes: 现有 `source`（`client/client.js` 的 UTF-8 文本）、`BotMarketLauncher` 的 `props.t / props.surfaceStore / props.onOpen`。
- Produces: 一条源码契约测试，锁定胶囊的 DOM 结构 + 类名 + `data-wide`；CSS 契约测试在 Task 3 与样式同批加入，保证 Task 2 的提交点仍然全绿。

- [ ] **Step 1: 写失败测试**

在 `test/client-bot-ui.test.js` 末尾追加：

```js
test('the Bot launcher renders a bordered pill with an icon, label and caret', () => {
  assert.match(source, /className: 'wbx-launcher'/)
  assert.match(source, /'data-wide': props\.wide === false \? 'false' : 'true'/)
  assert.match(source, /className: 'wbx-launcher-icon'/)
  assert.match(source, /className: 'wbx-launcher-label'/)
  assert.match(source, /className: 'wbx-launcher-caret'/)
  assert.match(source, /t\('nav'\)/)
  // The caret must be presentation-only: the button label is the nav text.
  assert.match(source, /'aria-hidden': true/)
  // No host API beyond the slot owner props.
  assert.doesNotMatch(source, /useLayoutEffect/)
  assert.doesNotMatch(source, /getBoundingClientRect/)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-bot-ui.test.js
```

Expected: FAIL，失败信息指向 `data-wide` / `-icon` / `-label` / `-caret` 尚未出现（例如 `The input did not match the regular expression`）。若测试没有失败，说明测试写错了，先修正测试。

- [ ] **Step 3: 提交失败测试**

```bash
cd packages/dsh-workbuddy-expert-plus
git status --short
git add test/client-bot-ui.test.js
git commit -m "test: lock the Bot launcher pill contract"
```

Expected: `git status --short` 只显示 `M test/client-bot-ui.test.js`；commit 成功。

---

### Task 2: 实现描边胶囊 DOM 与折叠态 `wide` 接线

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/client/client.js:2641-2658`（`BotMarketLauncher`）
- Modify: `packages/dsh-workbuddy-expert-plus/client/client.js:3372-3390`（`sidebar.footer.action` 注册的组件调用）
- Test: `packages/dsh-workbuddy-expert-plus/test/client-bot-ui.test.js`

**Interfaces:**
- Consumes: `BotMarketLauncher(props)`，其中 `props.t: (key: string) => string`、`props.surfaceStore: { get(): string, subscribe(fn): () => void } | undefined`、`props.onOpen?: () => void`、`props.wide?: boolean`。
- Produces: `BotMarketLauncher` 返回 `null`（非 Bot 模式）或一个 `<button class="wbx-launcher" data-wide="true|false">`，内部稳定包含 `.wbx-launcher-icon`、`.wbx-launcher-label`、`.wbx-launcher-caret` 三个子节点；注册处把宿主 owner props 的 `wide` 透传给组件。

- [ ] **Step 1: 写失败测试**

在 `test/client-surface.test.js` 的 `the sidebar launcher follows the live surface store without focus events` 之后追加：

```js
test('the sidebar launcher exposes the wide flag to CSS and keeps a stable label', async () => {
  const app = surfaceHarness(botOnly, 'agent')
  const wideView = renderComponent(module.BotMarketLauncher, {
    t: (key) => key,
    surfaceStore: app.store,
    onOpen() {},
    wide: true,
  })
  const tree = wideView.tree()
  assert.equal(tree?.type, 'button')
  assert.equal(tree?.props.className, 'wbx-launcher')
  assert.equal(tree?.props['data-wide'], 'true')
  assert.deepEqual(tree?.children.map((child) => child.props.className),
    ['wbx-launcher-icon', 'wbx-launcher-label', 'wbx-launcher-caret'])
  assert.equal(tree?.children[1].children[0], 'nav',
    'the label is the localized nav key, not a hardcoded string')
  assert.equal(tree?.children[2].props['aria-hidden'], true)

  const railView = renderComponent(module.BotMarketLauncher, {
    t: (key) => key,
    surfaceStore: app.store,
    onOpen() {},
    wide: false,
  })
  assert.equal(railView.tree()?.props['data-wide'], 'false')

  const legacyView = renderComponent(module.BotMarketLauncher, {
    t: (key) => key,
    surfaceStore: app.store,
    onOpen() {},
  })
  assert.equal(legacyView.tree()?.props['data-wide'], 'true',
    'a host that never sends wide keeps the expanded pill')
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-surface.test.js
```

Expected: FAIL，失败信息为 `expected undefined to equal 'true'`（`data-wide` 不存在）或 `Cannot read properties of undefined (reading 'props')`（子节点尚未拆成三段）。此时不要继续，确认测试确实因缺功能而失败。

- [ ] **Step 3: 实现 `BotMarketLauncher` 的三段 DOM**

把 `client/client.js` 中现有实现：

```js
/** The launching cell; hidden unless this window currently paints Bot mode. */
function BotMarketLauncher (props) {
  var t = props.t
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
  return el('button', {
    className: 'wbx-launcher', type: 'button',
    onClick: function () { if (typeof props.onOpen === 'function') props.onOpen() }
  }, t('nav'))
}
```

替换为：

```js
/**
 * The launching cell; hidden unless this window currently paints Bot mode.
 *
 * Presentation only: `wide` arrives from the `sidebar.footer.action` owner
 * props (the host passes `{ wide }`), and `data-wide` lets the scoped CSS
 * collapse the pill to a 36x36 icon in the rail without re-rendering on a
 * measured width. Missing `wide` (a host that never sends it) is treated as
 * expanded so an unknown shell keeps the readable label.
 */
function BotMarketLauncher (props) {
  var t = props.t
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
  return el('button', {
    className: 'wbx-launcher', type: 'button',
    'data-wide': props.wide === false ? 'false' : 'true',
    title: t('nav'),
    onClick: function () { if (typeof props.onOpen === 'function') props.onOpen() }
  },
  el('span', { className: 'wbx-launcher-icon', 'aria-hidden': true }, el(BotMarketLauncherIcon, null)),
  el('span', { className: 'wbx-launcher-label' }, t('nav')),
  el('span', { className: 'wbx-launcher-caret', 'aria-hidden': true }, el(BotMarketLauncherCaret, null)))
}

/**
 * The launcher glyph: a 16px four-point sparkle matching the host's
 * `IconSparkle` geometry, inlined because this zero-build bundle may only
 * require React (no primitives package export is guaranteed in every host).
 */
function BotMarketLauncherIcon () {
  return el('svg', {
    width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1, focusable: 'false'
  },
  el('path', { d: 'M5.875 3C5.875 6.33333 7.54167 8 10.875 8C7.54167 8 5.875 9.66667 5.875 13C5.875 9.66667 4.20833 8 0.875 8C4.20833 8 5.875 6.33333 5.875 3Z' }),
  el('path', { d: 'M12.375 1.55823C12.375 3.39156 13.2917 4.30823 15.125 4.30823C13.2917 4.30823 12.375 5.22489 12.375 7.05823C12.375 5.22489 11.4583 4.30823 9.625 4.30823C11.4583 4.30823 12.375 3.39156 12.375 1.55823Z' }),
  el('path', { d: 'M12.375 10.4418C12.375 11.7751 13.0417 12.4418 14.375 12.4418C13.0417 12.4418 12.375 13.1084 12.375 14.4418C12.375 13.1084 11.7083 12.4418 10.375 12.4418C11.7083 12.4418 12.375 11.7751 12.375 10.4418Z' }))
}

/** A 12px disclosure caret drawn as a stroke path, so it inherits currentColor. */
function BotMarketLauncherCaret () {
  return el('svg', {
    width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.2,
    strokeLinecap: 'round', strokeLinejoin: 'round', focusable: 'false'
  }, el('path', { d: 'M4.5 2.5 8 6l-3.5 3.5' }))
}
```

- [ ] **Step 4: 把 owner props 的 `wide` 透传给入口**

把 `client/client.js` 中 `sidebar.footer.action` 的组件函数（当前忽略参数的 `function () {`）改成接收 slot owner props 并转发 `wide`：

```js
    }, function (ownerProps) {
      // The launcher must live in the sidebar cell, but the open flag belongs
      // to the overlay cell. A tiny module-scope store keeps them in sync;
      // the surface store makes the cell itself follow live mode switches.
      // `wide` is the host's own collapsed/expanded flag (SidebarRoot passes
      // `{ wide }` to every `sidebar.footer.action` entry): forward it as a
      // presentation hint instead of measuring the DOM.
      return el(BotMarketLauncher, {
        t: t,
        surfaceStore: surfaceStore,
        wide: ownerProps !== undefined && ownerProps !== null ? ownerProps.wide : undefined,
        onOpen: function () { openBotMarket() }
      })
    })
```

- [ ] **Step 5: 运行两个测试文件并确认通过**

Run:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-bot-ui.test.js test/client-surface.test.js
```

Expected: PASS，两个文件 0 failures。Task 2 只是把 DOM 拆成三段并挂 `data-wide`，CSS 仍是旧样式，因此这里只验证行为契约与既有行为没有回归。

- [ ] **Step 6: 提交 DOM 接线**

```bash
cd packages/dsh-workbuddy-expert-plus
git status --short
git add client/client.js test/client-surface.test.js
git commit -m "feat: render the Bot launcher as an icon-label pill"
```

Expected: 提交包含 `client/client.js` 与新增测试，且 `git status --short` 为空。

---

### Task 3: 用 DSH token 实现胶囊样式、折叠态与动效降级

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/client/client.js:408-414`（`MARKET_CSS` 中的 `.wbx-launcher` 区块）
- Test: `packages/dsh-workbuddy-expert-plus/test/client-bot-ui.test.js`

**Interfaces:**
- Consumes: Task 2 产出的 `.wbx-launcher[data-wide]`、`.wbx-launcher-icon`、`.wbx-launcher-label`、`.wbx-launcher-caret`。
- Produces: 一组 scoped `.wbx-launcher*` 规则；展开态 32px 高/999px 圆角/1px 描边/图标+标签+箭头；`data-wide="false"` 时 36×36 纯图标；`:focus-visible` 有品牌色描边；`prefers-reduced-motion` 关闭过渡。全部颜色来自 token + fallback。

- [ ] **Step 1: 写 CSS 契约测试并确认失败**

在 `test/client-bot-ui.test.js` 末尾追加：

```js
test('the Bot launcher stylesheet uses theme tokens and a wide-aware rail state', () => {
  const block = source.match(/\.wbx-launcher \{[\s\S]*?\n\}/)
  assert.ok(block, '.wbx-launcher rule exists')
  assert.match(block[0], /border-radius: 999px/)
  assert.match(block[0], /border: 1px solid var\(--dsw-alias-border-l2,/)
  assert.match(block[0], /background: var\(--dsw-alias-bg-layer-2,/)
  assert.match(block[0], /color: var\(--dsw-alias-label-primary,/)
  assert.match(source, /\.wbx-launcher:hover:not\(:disabled\) \{[^}]*--dsw-interactive-bg-hover/)
  assert.match(source, /\.wbx-launcher\[data-wide="false"\] \{[^}]*width: 36px;[^}]*height: 36px;/)
  assert.match(source, /\.wbx-launcher\[data-wide="false"\] \.wbx-launcher-label \{[^}]*clip: rect\(0 0 0 0\)/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\) \{ \.wbx-launcher \{ transition: none; \} \}/)
})
```

Run:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-bot-ui.test.js
```

Expected: FAIL，命中 `.wbx-launcher` 的 `border-radius: 999px` / `background: var(--dsw-alias-bg-layer-2,` / `data-wide` 规则断言（旧样式仍是 `background: transparent`）。

- [ ] **Step 2: 替换 `.wbx-launcher` 样式块**

把 `client/client.js` 的 `MARKET_CSS` 中现有：

```css
/* ── Bot mode: sidebar launcher + own overlay (never a host DOM injection) ── */
.wbx-launcher { display: inline-flex; align-items: center; gap: 6px; width: 100%; padding: 7px 10px;
  border: 0; border-radius: 8px; background: transparent; cursor: pointer;
  color: var(--dsw-alias-label-secondary, inherit); font-size: 13px; line-height: 20px; text-align: left; }
.wbx-launcher:hover:not(:disabled) { background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.12));
  color: var(--dsw-alias-label-primary, inherit); }
.wbx-launcher:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, currentColor); outline-offset: 2px; }
```

替换为：

```css
/* ── Bot mode: sidebar launcher + own overlay (never a host DOM injection) ── */
/* Scheme B: a bordered pill. Every value is a DSH alias token with a
   theme-agnostic fallback, so a light/dark flip or a third-party theme's
   overrideTokens() restyles the entry without a re-render. The `wide` flag
   comes from the slot owner props (not a DOM measurement): false collapses
   the pill to the host rail's 36x36 hit target and keeps the glyph. */
.wbx-launcher { display: inline-flex; align-items: center; gap: 7px; width: 100%; box-sizing: border-box;
  height: 32px; padding: 0 10px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.32));
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,.10));
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; text-align: left;
  cursor: pointer; transition: background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease; }
.wbx-launcher:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l3, rgba(127,127,127,.48));
  background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.12));
  box-shadow: 0 1px 3px rgba(0,0,0,.08); }
.wbx-launcher:active:not(:disabled) { background: var(--dsw-interactive-bg-hover, rgba(127,127,127,.16)); }
.wbx-launcher:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, currentColor); outline-offset: 2px; }
.wbx-launcher:disabled { opacity: .55; cursor: default; }
.wbx-launcher-icon, .wbx-launcher-caret { display: inline-flex; flex: none; }
.wbx-launcher-icon { color: var(--dsw-alias-label-secondary, inherit); }
.wbx-launcher-caret { margin-left: auto; color: var(--dsw-alias-label-tertiary, var(--dsw-alias-label-secondary, inherit)); }
.wbx-launcher-label { min-width: 0; flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wbx-launcher[data-wide="false"] { width: 36px; min-width: 36px; height: 36px; padding: 0; gap: 0;
  justify-content: center; border-radius: 999px; }
.wbx-launcher[data-wide="false"] .wbx-launcher-label,
.wbx-launcher[data-wide="false"] .wbx-launcher-caret {
  position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
@media (prefers-reduced-motion: reduce) { .wbx-launcher { transition: none; } }
```

- [ ] **Step 3: 运行测试并确认通过**

Run:

```bash
cd packages/dsh-workbuddy-expert-plus && node --test test/client-bot-ui.test.js test/client-surface.test.js
```

Expected: PASS，两个文件 0 failures。若 `client-bot-ui` 仍报 CSS 断言失败，逐条对照 Step 2 的声明（尤其 `border-radius: 999px` 必须在 `.wbx-launcher { ... }` 的首个规则块内，`data-wide="false"` 规则的 `width: 36px;` 与 `height: 36px;` 必须在同一声明块）。

- [ ] **Step 4: 提交样式**

```bash
cd packages/dsh-workbuddy-expert-plus
git status --short
git add client/client.js test/client-bot-ui.test.js
git commit -m "feat: style the Bot launcher as a theme-aware pill"
```

Expected: commit 成功，`git status --short` 为空。

---

### Task 4: 全量回归、真实主题视觉验收与证据记录

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/docs/verification-report.md`（追加一行验收记录）
- Test: `packages/dsh-workbuddy-expert-plus/test/*.test.js`（只运行，不改）
- Artifact: `output/playwright/launcher-options.png`（已存在的方案 B 参考图，不打包）
- Installed profile (只替换本 profile 的 plugin 安装，不改 DS-Bot 本体): `C:\Users\guojl\.dsh\profiles\ds-bot\package.json`

**Interfaces:**
- Consumes: Task 2/3 的 `.wbx-launcher` 展开/折叠态与 `data-wide`。
- Produces: 全量测试通过输出、`npm run check:package` 的 `"ok": true` JSON、verification report 中一条带命令与证据的 2026-10-29 记录，以及一张用真实 DSH token 渲染的最终视觉截图。

**实机安装说明（本机现状）：** DS-Bot profile 的 `package.json` 依赖是
`"dsh-workbuddy-expert-plus": "file:D:/code/ai/dsh-workbuddy-expert/packages/dsh-workbuddy-expert-plus/build/dsh-workbuddy-expert-plus-0.1.1.tgz"`，
即它消费的是**已打包的 tgz**，不是本仓库源码。只改源码不会改变正在运行的 DS-Bot。验收必须先把新 tgz 装进 profile，然后重启 DS-Bot 让新 bundle 生效。

- [ ] **Step 1: 运行全量测试**

Run:

```bash
cd packages/dsh-workbuddy-expert-plus && npm test
```

Expected: `ℹ tests` 计数 ≥ 89、`ℹ fail 0`，并看到 `smoke: all checks passed`、`smoke-client: all checks passed`、`smoke-importer: all checks passed`、`smoke-install: all checks passed`。把完整输出留到记录里，不只记“通过”。

- [ ] **Step 2: 运行包完整性检查**

Run:

```bash
cd packages/dsh-workbuddy-expert-plus && npm run check:package
```

Expected: 末尾 JSON 含 `"ok": true`，且 `files` 计数与改动前一致（本计划只改 `client/client.js` 与测试，不新增打包文件）。若 `"ok": false`，读取 `errors` 数组修复后重跑，不要跳过。

- [ ] **Step 3: 用真实 token 渲染三态截图**

用 `output/playwright/launcher-options.html` 已实现的浅色/深色/折叠规格，确认最终实现与参考图一致：按钮为 32px 高、999px 圆角、1px 描边、左侧星形图标、右侧箭头；折叠为 36×36 纯图标。启动本地静态服务并截图：

```bash
cd /d/code/ai/dsh-workbuddy-expert
node -e "const http=require('http'),fs=require('fs');http.createServer((q,r)=>{try{const p=decodeURIComponent(q.url.split('?')[0]);r.writeHead(200,{'content-type':'text/html; charset=utf-8'});r.end(fs.readFileSync('output/playwright'+p))}catch(e){r.writeHead(404);r.end('no')}}).listen(8891,'127.0.0.1')" &
sleep 1
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" -s=wbverify open "http://127.0.0.1:8891/launcher-options.html"
"$PWCLI" -s=wbverify resize 1200 900
"$PWCLI" -s=wbverify screenshot --full-page
```

Expected: Playwright 输出截图路径；图片中三列分别展示浅色常态、浅色悬停、深色常态、折叠态，方案 B 的胶囊在深色下有可见边框、折叠后只剩图标。人工核对后把截图复制为 `output/playwright/launcher-options-final.png`。

- [ ] **Step 4: 把新包装进 DS-Bot profile**

先确认 0.2.1 的 tgz 已经包含 Task 2/3 的源码（`check:package` 会重新 pack 当前工作树；不要复用 10 月 28 日的旧包）。然后：

```bash
cd /c/Users/guojl/.dsh/profiles/ds-bot
cp package.json package.json.bak-before-pill
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies['dsh-workbuddy-expert-plus']='file:D:/code/ai/dsh-workbuddy-expert/packages/dsh-workbuddy-expert-plus/build/dsh-workbuddy-expert-plus-0.2.1.tgz';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
npm install --no-audit --no-fund
```

Expected: `npm install` 退出码 0，`node_modules/dsh-workbuddy-expert-plus/client/client.js` 中出现 `wbx-launcher-caret` 与 `border-radius: 999px`。用下面的命令自证：

```bash
grep -n "wbx-launcher-caret\|border-radius: 999px" /c/Users/guojl/.dsh/profiles/ds-bot/node_modules/dsh-workbuddy-expert-plus/client/client.js
```

Expected: 至少命中 `wbx-launcher-caret` 一行、`border-radius: 999px` 一行；若没有，说明 tgz 是旧包，回到 Step 2 重跑 `check:package`。

- [ ] **Step 5: 重启 DS-Bot 并实机核对**

关闭并重新启动 DS-Bot 桌面应用（不是刷新网页），切到 Bot 模式，查看侧栏底部入口：

- 展开态应为 32px 高、999px 圆角、1px 描边，左侧星形图标 + `WorkBuddy 专家` + 右侧箭头。
- 收起侧栏后应为 36×36 的纯图标圆钮，不出现文字残影或布局抖动。
- 在 DS-Bot 设置里切换亮/暗主题，入口边框与底色应随主题变化，不需要重开面板。

如果实机效果与参考图不一致，记录实际现象和截图，不要改验收结论为通过。

- [ ] **Step 6: 追加验收记录**

在 `docs/verification-report.md` 末尾追加（保留既有格式；把命令输出中的真实计数填进占位处，不允许留占位符）：

```markdown
## 2026-10-29 — Bot 侧栏入口方案 B（描边胶囊）

- 变更：`client/client.js` 的 `BotMarketLauncher` 改为 32px 描边胶囊（图标 + `nav` 文案 + 箭头），并用 `sidebar.footer.action` 的 `wide` owner prop 驱动 `data-wide`；`data-wide="false"` 收为 36×36 纯图标。颜色全部来自 DSH token，亮/暗与第三方主题切换无需重渲染。
- 契约测试：`node --test test/client-bot-ui.test.js test/client-surface.test.js` — 全部通过（新增 3 条入口断言）。
- 全量回归：`npm test` — N tests, 0 fail；四条 smoke 全部通过。
- 打包完整性：`npm run check:package` — `"ok": true`，`files` = N。
- 实机安装：DS-Bot profile 的 tgz 已指向 `build/dsh-workbuddy-expert-plus-0.2.1.tgz`，`node_modules` 内的 bundle 含 `wbx-launcher-caret`；重启 DS-Bot 后展开/折叠/亮暗三态已人工核对。
- 视觉证据：`output/playwright/launcher-options-final.png`（浅色常态、浅色悬停、深色常态、折叠态）；参考 HTML 为 `output/playwright/launcher-options.html`。
- 未覆盖：折叠态由宿主 `wide` 驱动而非实际测量，若未来 DS-Bot 不再向 footer entry 传 `wide`，入口会按展开态渲染（不会变成空图标）。
```

把 `N tests`、`files = N`、`0 fail` 改成 Step 1/Step 2 的真实数字；实机一行只有在 Step 5 真正完成后才能保留。

- [ ] **Step 7: 提交验收记录**

```bash
cd packages/dsh-workbuddy-expert-plus
git status --short
git add docs/verification-report.md
git commit -m "docs: record the Bot launcher pill verification"
```

Expected: commit 成功，`git status --short` 为空。

---

## 完成后核对清单

- [ ] 展开态：32px 高、999px 圆角、1px DSH 边框、图标 + 文案 + 箭头，文案走 `nav` key。
- [ ] 折叠态：`wide=false` → 36×36、只有星形图标、无文字残留、无箭头。
- [ ] 主题：浅色/深色/第三方主题切换只靠 CSS token，无 JS 监听、无硬编码主题色。
- [ ] 交互：hover 边框加深 + 背景变化；focus-visible 2px 品牌色描边；disabled 降透明度；减少动效时无过渡。
- [ ] 兼容：`wide` 缺省按展开态；老宿主没有 `--dsw-*` 时 rgba fallback 仍可见。
- [ ] 边界：不改 DS-Bot、不写私有 storage、不新增 DOM 注入、不新增依赖、不新增 locale key。
