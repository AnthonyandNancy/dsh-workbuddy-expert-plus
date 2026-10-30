# Bot 弹窗滚动/层级与入口悬浮态修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Bot 模式的 WorkBuddy 专家市场弹窗在 DSH `0.2.1-rc.4` + DS Bot `0.2.4` 中真正可滚动、层级高于 Bot 侧栏，并让侧栏入口在 hover/active 时保持实底、不透明、不发虚。

**Architecture:** 弹窗与入口都继续由插件自己的 React 根渲染，但不再依赖 DSH `shell.overlay` 的命中层：两个 host 都通过 `react-dom` 的 `createPortal` 挂到 `document.body`，各自拥有独立固定定位的外壳。弹窗外壳 `z-index: 10020` 并显式 `pointer-events: auto`；入口外壳 `z-index: 30`，仅入口面板 `pointer-events: auto`。入口底色改为不透明的 `bg-layer-2` 实底，hover/active 只叠一层带 alpha 的 tint（`inset box-shadow`），不再用半透明 `background` 替换实底。

**Tech Stack:** 零构建 CJS 客户端 bundle（`window.__ModuleLoader__`）、React 18 函数组件 + `react-dom/createPortal`、`node:test` + VM React stub、Playwright CLI（真实 DSH Web + DS Bot 0.2.4 profile）。

## Global Constraints

- 目标宿主版本：DSH `0.2.1-rc.4`、DS Bot `0.2.4`；不得只按源码推断，必须在真实窗口复验。
- 不修改 DS-Bot 源码，不写 `localStorage['ds-bot:*']`，不使用 `MutationObserver`，不接管 `sidebar.workspaces`，不向宿主 DOM 结构性注入节点。
- `react-dom` 可能不可用：`createPortal` 不存在时必须安全降级为普通节点，不能抛错。
- 无 `document` / SSR 环境不得访问 `document.body`。
- Agent 模式继续只保留原 `sidebar.footer.action` 入口；Bot 模式不得出现两个可见入口；`bot-pending` 两处都隐藏。
- 不引入新依赖、不引入构建步骤；`client/client.js` 仍是唯一客户端产物。
- 所有颜色继续走 DSH token，并保留无 token 时的实底 fallback。
- 测试只增加行为断言，不为实现细节写脆弱选择器；真实窗口证据必须落到 `output/playwright/`。
- 包内 git 根目录是 `packages/dsh-workbuddy-expert-plus`；所有 `git` 命令在该目录运行。

---

## 根因（已用真实 0.2.4 页面取证）

| 现象 | 证据 | 根因 |
|---|---|---|
| 弹窗完全不能滚动 | `.wbx-modal`：`scrollHeight=31642`、`clientHeight=632`、`overflow-y:auto`，但 computed `pointer-events:none`；`.wbx-overlay` 同样 `none`；`elementFromPoint(640,360)` 命中 `wSkVaW_scrollBody`；真实滚轮后 `scrollTop` 仍为 `0` | 弹窗挂在 `shell.overlay` 的 `.overlayLayer` 内，该层 `pointer-events:none`；插件只给 `.wbx-launcher-host` 恢复了 `auto`，漏掉了弹窗。命中测试穿透到聊天区，滚轮自然滚不到弹窗 |
| 弹窗层级错误、被 Bot 侧栏遮挡 | 弹窗祖先 `.pI_x6G_overlayLayer` 的 `z-index:20`；DS-Bot `.bt-leftcol` 是 `document.body` 子节点、`position:fixed`、`z-index:25`；真实截图里侧栏压在弹窗左侧之上 | 只把入口 portal 到 body 提高了入口，弹窗仍留在 `z-index:20` 的 shell overlay 内，低于 DS-Bot 侧栏 |
| 入口 hover 发虚、透出下层 Bot 卡片 | 非 hover：`background: rgb(255,255,255)`；hover：`background: rgba(127,127,127,.12)`，`opacity:1`、无 `filter`/`backdrop-filter`；用户截图可见下层「产品通」头像与文字透过胶囊 | `.wbx-launcher:hover` 把不透明底色整体替换成 12% alpha 的 `interactive-bg-hover`，并非在其上叠加 tint；`active` 同理 |
| 同一位置疑似两个入口 | 真实 DOM 中同时存在 `.hHd-Xa_footerActions .wbx-launcher[data-wide=false]`（36×36，祖先宽 0、被 shell 侧栏 `overflow:hidden` 裁掉）与 `.wbx-launcher-host .wbx-launcher[data-wide=true]`（232×32）；`elementFromPoint` 命中 portal 入口 | 隐藏的 shell footer 仍渲染 React 树，但被 0 宽祖先裁剪，用户看不到也点不到；它不是视觉重影的成因。修复入口实底后无需删除 footer 注册（Agent 模式仍依赖它） |

## 解决方案

1. **弹窗宿主 portal 到 body，自建满屏定位外壳**：新增 `BotMarketOverlayPortal`（或等价 host）包住 `BotMarketOverlayHost`，用 `ReactDOM.createPortal` 挂 `document.body`，外层类 `.wbx-overlay-portal-host`。没有 `react-dom` 时返回普通节点，避免白屏。
2. **恢复弹窗命中并抬高层级**：`.wbx-overlay-portal-host { position: fixed; inset: 0; z-index: 10020; pointer-events: none; }`，把 `.wbx-overlay` 的 `pointer-events` 明确设为 `auto`，`.wbx-modal` 也显式 `auto`（防御宿主或主题的继承覆盖）。这样遮罩、弹窗、滚轮、点遮罩关闭都恢复，且高于 `.bt-leftcol(z=25)`。
3. **入口底色不透明，交互态只叠 tint**：`.wbx-launcher` 背景改为 `SOLID_SURFACE`（`var(--dsw-alias-bg-layer-2, rgba(127,127,127,1))`），hover 不再改 `background`，改用 `box-shadow: inset 0 0 0 999px var(--dsw-interactive-bg-hover, rgba(127,127,127,.12))` + 边框/投影；active 用更高 alpha 的 inset tint。这样底色始终不透明，tint 不会透出下层内容。
4. **不新增第二个入口**：保留 `sidebar.footer.action`（Agent 用）与 `shell.overlay` 里的 `BotMarketLauncherHost`（Bot 用），surface store 已保证互斥；本次不改 surface 判定。

## File Structure

| 文件 | 责任 |
|---|---|
| `client/client.js` | 新增弹窗 portal host；调整 `.wbx-overlay*` 与 `.wbx-launcher*` CSS；导出新组件供测试 |
| `test/client-surface.test.js` | 行为测试：portal 目标、无 react-dom 降级、pointer-events/z-index 契约、hover 不透明契约 |
| `test/plugin-lifecycle.test.js` | 座位契约：`shell.overlay` 仍注册两个 host，弹窗 host 不被误删 |
| `docs/verification-report.md` | 记录本轮真实窗口证据、截图路径、测试计数 |
| `output/playwright/bot-overlay-scroll-fixed.png` | 修复后弹窗滚动与层级截图 |
| `output/playwright/bot-launcher-hover-fixed.png` | 修复后入口 hover 实底截图 |

---

### Task 1: 弹窗 portal 到 body，恢复命中与层级

**Files:**
- Modify: `client/client.js:445-459`（`.wbx-overlay*` CSS）、`client/client.js:3090-3130`（`BotMarketOverlayHost` 附近）、`client/client.js:3530-3550`（overlay 注册）、`client/client.js:3600-3620`（exports）
- Test: `test/client-surface.test.js`（overlay host 相关测试区，约 380-530 行）

**Interfaces:**
- Consumes: `BotMarketOverlayHost(props)`（现有）、`ReactDOM.createPortal(node, document.body)`（现有可选依赖）、`module.openBotMarket()` / `module.closeBotMarket()`。
- Produces: `BotMarketOverlayPortal(props)`，props 与 `BotMarketOverlayHost` 相同（`t`、`localeId`、`surfaceStore`）；返回 `ReactDOM.createPortal(div.wbx-overlay-portal-host > BotMarketOverlayHost, document.body)`，无 `react-dom`/`document` 时返回同一 `div` 普通节点；`module.exports.BotMarketOverlayPortal`。

- [ ] **Step 1: 写失败测试（portal 目标 + 无 react-dom 降级）**

在 `test/client-surface.test.js` 的 `leaving Bot mode closes an open market overlay` 之后加入：

```js
test('the Bot market dialog portals to body so DS-Bot z-index 25 cannot cover it', async () => {
  const app = surfaceHarness(botOnly, 'agent')
  portalTargets.length = 0
  const host = renderComponent(module.BotMarketOverlayPortal, {
    t: (key) => key,
    localeId: 'zh',
    surfaceStore: app.store,
  })
  module.openBotMarket()
  await host.flush()
  const tree = host.tree()
  assert.equal(tree?.props.className, 'wbx-overlay-portal-host')
  assert.equal(portalTargets.length, 1,
    'the dialog must leave the z-index 20 shell overlay layer')
  assert.equal(portalTargets[0], sandbox.document.body,
    'the portal target is document.body, the same level DS-Bot uses')
  assert.equal(tree?.children?.[0]?.type, module.BotMarketOverlayHost,
    'the portal host wraps the existing dialog host')
  module.closeBotMarket()
})

test('the Bot market dialog falls back to an inline host without document.body', () => {
  const app = surfaceHarness(botOnly, 'agent')
  let noDomDefinition
  const noDomSandbox = {
    window: { __ModuleLoader__: { load: (value) => { noDomDefinition = value } } },
    document: { body: null },
    console,
    React: makeReactStub(),
  }
  noDomSandbox.globalThis = noDomSandbox
  vm.runInContext(source, vm.createContext(noDomSandbox), { filename: 'client/client.js' })
  const fallbackModule = noDomDefinition.factory((name) => (name === 'react-dom'
    ? { createPortal() { throw new Error('must not portal without document.body') } }
    : makeReactStub()))
  module.openBotMarket()
  const view = renderComponent(fallbackModule.BotMarketOverlayPortal, {
    t: (key) => key,
    localeId: 'zh',
    surfaceStore: app.store,
  })
  assert.equal(view.tree()?.props.className, 'wbx-overlay-portal-host',
    'no document.body must degrade to an inline wrapper, not crash')
  module.closeBotMarket()
})
```

> 说明：现有 VM 的 `sandbox.document.body` 目前是 `undefined`，Step 2 会补成 `{}`，这样第一条测试能证明 portal 真的发往 `document.body`，而第二条用独立的 `body: null` sandbox 证明降级路径。

- [ ] **Step 2: 让测试夹具支持 body 与无 body 两种环境**

修改 `test/client-surface.test.js` 顶部 sandbox，只增加一行 `body`：

```js
  document: {
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    querySelector: () => null,
    head: { appendChild() {} },
    body: {}, // createPortal target; not a real DOM node
  },
```

独立 sandbox 已在 Step 1 的降级测试里创建，不需要再改夹具。

- [ ] **Step 3: 运行测试确认 RED**

Run:

```bash
cd /d/code/ai/dsh-workbuddy-expert/packages/dsh-workbuddy-expert-plus
node --test --test-name-pattern="portals to body|falls back to an inline host" test/client-surface.test.js
```

Expected: FAIL，`module.BotMarketOverlayPortal is not a function`，或 portal 目标不是 `document.body`。

- [ ] **Step 4: 实现 `BotMarketOverlayPortal`**

在 `client/client.js` 的 `BotMarketOverlayHost` 之后加入：

```js
/**
 * The dialog's body-level portal. `shell.overlay` is inside a
 * `pointer-events:none` layer at z-index 20; DS-Bot's left column is a
 * body-level fixed node at z-index 25. Rendering the dialog in that seat
 * leaves it painted but not hit-testable and partially covered. This host
 * is the plugin's own React root at body level, the same public technique
 * DS-Bot itself uses - no host DOM is structurally injected.
 */
function BotMarketOverlayPortal (props) {
  var panel = el('div', { className: 'wbx-overlay-portal-host' },
    el(BotMarketOverlayHost, props))
  if (ReactDOM !== null && typeof ReactDOM.createPortal === 'function' &&
      typeof document !== 'undefined' && document !== null && document.body) {
    return ReactDOM.createPortal(panel, document.body)
  }
  return panel
}
```

在 overlay 注册中把 `<BotMarketOverlayHost ... />` 换成：

```js
        el(BotMarketOverlayPortal, {
          t: t,
          localeId: getLocale(),
          surfaceStore: surfaceStore
        }))
```

并在 exports 中加入：

```js
module.exports.BotMarketOverlayPortal = BotMarketOverlayPortal
```

- [ ] **Step 5: 调整 CSS，恢复弹窗命中并抬高层级**

把 `.wbx-overlay` 与 `.wbx-modal` 两行改成：

```css
.wbx-overlay-portal-host { position: fixed; inset: 0; z-index: 10020; pointer-events: none; }
.wbx-overlay { position: fixed; inset: 0; z-index: 10020; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgba(0,0,0,.42); pointer-events: auto; }
```

并在 `.wbx-modal` 规则中加：

```css
  pointer-events: auto;
```

`@media (max-width: 560px)` 保持原样。

- [ ] **Step 6: 加 CSS 契约测试**

在 `test/client-surface.test.js` 的 `overlay stack does not become a full-screen interactive hit target` 后加入：

```js
test('the Bot dialog restores pointer events and sits above the DS-Bot left column', () => {
  assert.match(module.MARKET_CSS, /\.wbx-overlay-portal-host \{[^}]*z-index: 10020;/,
    'the dialog portal must outrank the left column at z-index 25')
  assert.match(module.MARKET_CSS, /\.wbx-overlay \{[^}]*pointer-events: auto;/,
    'the shell overlay layer inherits pointer-events:none, so the dialog must opt back in')
  assert.match(module.MARKET_CSS, /\.wbx-modal \{[^}]*pointer-events: auto;/,
    'the scroll container itself must be hit-testable so wheel events reach it')
})
```

- [ ] **Step 7: 运行测试确认 GREEN**

Run:

```bash
node --test test/client-surface.test.js
```

Expected: 现有 18 个测试 + 新增 3 个全部 PASS，无 warning。

- [ ] **Step 8: 更新 lifecycle 座位测试**

在 `test/plugin-lifecycle.test.js` 的 `the overlay seat carries a Bot-mode launcher host without a full-screen shield` 中，把最后一条断言从：

```js
  assert.equal(overlayTree.children[1]?.type, app.module.BotMarketOverlayHost,
    'the overlay seat still mounts the market dialog host')
```

改为：

```js
  assert.equal(overlayTree.children[1]?.type, app.module.BotMarketOverlayPortal,
    'the overlay seat mounts the body-portal wrapper for the market dialog')
  assert.match(source, /function BotMarketOverlayPortal \(props\)/)
```

- [ ] **Step 9: 运行 lifecycle 测试**

Run:

```bash
node --test test/plugin-lifecycle.test.js
```

Expected: PASS。

- [ ] **Step 10: 提交**

```bash
git add client/client.js test/client-surface.test.js test/plugin-lifecycle.test.js
git commit -m "fix: portal the Bot market dialog above the DS Bot sidebar"
```

---

### Task 2: 入口 hover/active 改为不透明实底 + tint

**Files:**
- Modify: `client/client.js:414-428`（`.wbx-launcher` / `:hover` / `:active`）
- Test: `test/client-surface.test.js`（launcher 样式区，约 530-560 行）

**Interfaces:**
- Consumes: 现有 `.wbx-launcher` DOM（`button[data-wide]`）与 `SOLID_SURFACE` 常量。
- Produces: `.wbx-launcher` 的 `background` 始终为 `SOLID_SURFACE`；`:hover` 只增加 `inset` tint、边框和阴影；`:active` 只增加更强 `inset` tint。

- [ ] **Step 1: 写失败测试**

在 `the Bot overlay launcher sits in the sidebar foot band` 之后加入：

```js
test('the launcher hover keeps an opaque surface and only adds a tint', () => {
  const base = module.MARKET_CSS.match(/\.wbx-launcher \{[^}]*\}/)?.[0] || ''
  const hover = module.MARKET_CSS.match(/\.wbx-launcher:hover:not\(:disabled\) \{[^}]*\}/)?.[0] || ''
  const active = module.MARKET_CSS.match(/\.wbx-launcher:active:not\(:disabled\) \{[^}]*\}/)?.[0] || ''
  assert.match(base, /background: var\(--dsw-alias-bg-layer-2, rgba\(127,127,127,1\)\)/,
    'the resting surface must be fully opaque')
  assert.doesNotMatch(hover, /background:/,
    'hover must not replace the opaque base with an alpha colour')
  assert.match(hover, /box-shadow:[^;]*inset/,
    'hover tint is an inset layer over the opaque base')
  assert.doesNotMatch(active, /background:/)
  assert.match(active, /box-shadow:[^;]*inset/)
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run:

```bash
node --test --test-name-pattern="launcher hover keeps an opaque surface" test/client-surface.test.js
```

Expected: FAIL，hover 规则仍含 `background:`。

- [ ] **Step 3: 改 CSS**

把三条规则替换为：

```css
.wbx-launcher { display: inline-flex; align-items: center; gap: 7px; width: 100%; box-sizing: border-box;
  height: 32px; padding: 0 10px; overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l2, rgba(127,127,127,.32));
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, rgba(127,127,127,1));
  color: var(--dsw-alias-label-primary, inherit);
  font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500; text-align: left;
  cursor: pointer; transition: box-shadow 120ms ease, border-color 120ms ease; }
.wbx-launcher:hover:not(:disabled) {
  border-color: var(--dsw-alias-border-l3, rgba(127,127,127,.48));
  box-shadow: inset 0 0 0 999px var(--dsw-interactive-bg-hover, rgba(127,127,127,.12)),
    0 2px 4px rgba(0,0,0,.08); }
.wbx-launcher:active:not(:disabled) {
  box-shadow: inset 0 0 0 999px var(--dsw-interactive-bg-hover, rgba(127,127,127,.16)); }
```

- [ ] **Step 4: 运行测试确认 GREEN**

Run:

```bash
node --test --test-name-pattern="launcher hover keeps an opaque surface|foot band|portals above" test/client-surface.test.js
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add client/client.js test/client-surface.test.js
git commit -m "fix: keep the Bot launcher opaque on hover"
```

---

### Task 3: 全量测试 + 真实 0.2.4 窗口验证

**Files:**
- Modify: `docs/verification-report.md`
- Create: `output/playwright/bot-overlay-scroll-fixed.png`、`output/playwright/bot-launcher-hover-fixed.png`

**Interfaces:**
- Consumes: Task 1/2 的 bundle；真实 DSH Web profile `.tmp-review/e2e-bot024`（`ds-bot` 0.2.4 junction、插件已 junction 到工作区）。
- Produces: 通过/失败证据与截图。

- [ ] **Step 1: 跑全量测试**

```bash
cd /d/code/ai/dsh-workbuddy-expert/packages/dsh-workbuddy-expert-plus
npm test
```

Expected: `node --test` 全部 PASS（97 + 新增 4 = 101），4 个 smoke 全 PASS。

- [ ] **Step 2: 启动真实 0.2.4 Web profile**

```bash
cd /d/code/ai/dsh-workbuddy-expert/.tmp-review/e2e-bot024
DSH_HOME="$PWD/data" node ../asar-full/node_modules/@deepseek-ai/dsh/lib/bin.js web --no-open --port 4319 > web7.log 2>&1 &
cat web7.log
```

Expected: 打印 `dsh web: http://127.0.0.1:4319/?token=...`，无 `ERR_MODULE_NOT_FOUND`。

- [ ] **Step 3: 打开并进入 Bot 模式**

```bash
export PWCLI="/c/Users/guojl/.dsh/skills/playwright/scripts/playwright_cli.sh"
URL=$(grep -o 'http://127.0.0.1:4319/?token=[^ ]*' web7.log)
"$PWCLI" open "$URL" --headed
"$PWCLI" resize 1280 720
```

如果出现“开始使用”对话框，先点关闭再继续。

- [ ] **Step 4: 验证弹窗滚动**

```bash
"$PWCLI" click ".wbx-launcher-host .wbx-launcher"
sleep 1
"$PWCLI" eval "() => { const md=document.querySelector('.wbx-modal'); const ov=document.querySelector('.wbx-overlay'); const p=document.querySelector('.wbx-overlay-portal-host'); return {portalParent:p&&p.parentElement.tagName, portalZ:p&&getComputedStyle(p).zIndex, overlayPE:ov&&getComputedStyle(ov).pointerEvents, modalPE:getComputedStyle(md).pointerEvents, scrollTop:md.scrollTop, max:md.scrollHeight-md.clientHeight, hit:document.elementFromPoint(md.getBoundingClientRect().x+360, md.getBoundingClientRect().y+300)?.className} }"
```

Expected: `portalParent: "BODY"`、`portalZ: "10020"`、`overlayPE: "auto"`、`modalPE: "auto"`、`hit` 是弹窗内部元素（非 `wSkVaW_scrollBody`）。

```bash
"$PWCLI" mousemove 640 360
"$PWCLI" mousewheel 0 500
sleep 0.4
"$PWCLI" eval "() => document.querySelector('.wbx-modal').scrollTop"
```

Expected: 数值 > 0（约 500）。

- [ ] **Step 5: 验证弹窗高于侧栏**

```bash
"$PWCLI" eval "() => { const md=document.querySelector('.wbx-modal').getBoundingClientRect(); const col=document.querySelector('.bt-leftcol').getBoundingClientRect(); return {modal:[md.x,md.y,md.width,md.height], col:[col.x,col.y,col.width,col.height], overlap: md.x < col.x+col.width, hitLeft: document.elementFromPoint(280,360)?.className, colZ:getComputedStyle(document.querySelector('.bt-leftcol')).zIndex} }"
```

Expected: 命中弹窗内部（含 `.wbx-modal` 祖先），不是 `.bt-leftcol`。

- [ ] **Step 6: 验证入口 hover 实底**

```bash
"$PWCLI" press Escape
sleep 0.4
"$PWCLI" hover ".wbx-launcher-host .wbx-launcher"
sleep 0.3
"$PWCLI" eval "() => { const b=document.querySelector('.wbx-launcher-host .wbx-launcher'); const c=getComputedStyle(b); return {hover:b.matches(':hover'), bg:c.backgroundColor, shadow:c.boxShadow, label:c.color} }"
```

Expected: `bg` 是 `rgb(255, 255, 255)`（浅色）或 `rgb(44, 44, 46)`（深色），**不是** `rgba(127, 127, 127, 0.12)`；`shadow` 含 `inset`。

```bash
"$PWCLI" screenshot
```

把截图复制到 `output/playwright/bot-launcher-hover-fixed.png`，人工确认胶囊内没有下层卡片文字/头像透出。

- [ ] **Step 7: 深色模式回归**

```bash
"$PWCLI" set-color-scheme dark
sleep 0.5
"$PWCLI" hover ".wbx-launcher-host .wbx-launcher"
"$PWCLI" eval "() => { const c=getComputedStyle(document.querySelector('.wbx-launcher-host .wbx-launcher')); return {bg:c.backgroundColor, shadow:c.boxShadow, color:c.color} }"
```

Expected: 深色实底（`rgb(44, 44, 46)` 或等价 token 值），仍含 inset 阴影，文字对比正常。完成后 `clear-color-scheme`。

- [ ] **Step 8: 模式切换回归**

```bash
"$PWCLI" localstorage-set "ds-bot:surface" "agent"
"$PWCLI" reload
sleep 2.5
"$PWCLI" eval "() => ({launchers: document.querySelectorAll('.wbx-launcher').length, overlayPortal: document.querySelectorAll('.wbx-overlay-portal-host').length})"
```

Expected: `launchers: 0`、`overlayPortal: 0`（Agent 模式不残留 Bot 入口/弹窗）。

再切回 `bot` 并 reload，Expected: 入口恢复 1 个可见（`data-wide="true"`），弹窗默认关闭。

- [ ] **Step 9: 截图与记录**

```bash
cp "$(ls -t .playwright-cli/page-*.png | head -1)" output/playwright/bot-overlay-scroll-fixed.png
```

在 `docs/verification-report.md` 追加 2026-10-30 第二轮小节，记录：

- 根因三条与真实 computed style 数值；
- 修复后 `portalParent/z-index/pointer-events/scrollTop` 实测；
- 入口 hover 浅色/深色实测背景值；
- 测试计数；
- 截图路径。

- [ ] **Step 10: 提交文档**

```bash
git add docs/verification-report.md
git commit -m "docs: record the Bot overlay scroll and launcher surface verification"
```

---

### Task 4: 打包复核

**Files:**
- Verify: `build/dsh-workbuddy-expert-plus-0.2.1.tgz`

- [ ] **Step 1: 重建并校验包**

```bash
cd /d/code/ai/dsh-workbuddy-expert/packages/dsh-workbuddy-expert-plus
npm run check:package
```

Expected: `ok: true`，tarball 内 `client/client.js` 含 `BotMarketOverlayPortal` 与 `wbx-overlay-portal-host`。

- [ ] **Step 2: 确认工作区干净**

```bash
git status --short
git log --oneline -4
```

Expected: 工作区干净；最近提交为本次三条修复与一条文档提交。

---

## 验收标准

1. Bot 模式点入口打开市场后，鼠标滚轮能滚动卡片列表，滚动条可拖动，`scrollTop` 随滚轮变化。
2. 弹窗遮罩覆盖全屏，侧栏不会再压在弹窗上方；点击遮罩空白处可关闭。
3. 入口 hover/active 时背景保持不透明，浅色/深色都不透出 Bot 列表卡片。
4. Agent 模式没有 Bot 入口或弹窗残留；切回 Bot 后入口恢复、弹窗保持关闭。
5. `npm test` 全绿，真实 0.2.4 截图与 computed style 证据齐备。
