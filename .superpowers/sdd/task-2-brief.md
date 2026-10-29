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

