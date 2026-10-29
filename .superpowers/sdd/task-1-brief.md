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
  // Scope the contract to the launcher implementation: `t('nav')`,
  // `aria-hidden` and these class names also appear in unrelated settings and
  // market code, so a file-wide match would pass without the launcher.
  const launcher = source.match(/function BotMarketLauncher \(props\) \{[\s\S]*?\n\}/)
  assert.ok(launcher, 'BotMarketLauncher is defined')
  const block = launcher[0]
  assert.match(block, /className: 'wbx-launcher'/)
  assert.match(block, /'data-wide': props\.wide === false \? 'false' : 'true'/)
  assert.match(block, /className: 'wbx-launcher-icon'/)
  assert.match(block, /className: 'wbx-launcher-label'/)
  assert.match(block, /className: 'wbx-launcher-caret'/)
  assert.match(block, /t\('nav'\)/)
  // The caret must be presentation-only: the button label is the nav text.
  assert.match(block, /'aria-hidden': true/)
  // No host API beyond the slot owner props.
  assert.doesNotMatch(block, /useLayoutEffect/)
  assert.doesNotMatch(block, /getBoundingClientRect/)
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

