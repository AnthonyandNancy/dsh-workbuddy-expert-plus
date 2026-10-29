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
  const block = source.match(/\.wbx-launcher \{[\s\S]*?; \}/)
  assert.ok(block, '.wbx-launcher rule exists')
  assert.match(block[0], /border-radius: 999px/)
  assert.match(block[0], /border: 1px solid var\(--dsw-alias-border-l2,/)
  assert.match(block[0], /background: var\(--dsw-alias-bg-layer-2,/)
  assert.match(block[0], /color: var\(--dsw-alias-label-primary,/)
  assert.match(source, /\.wbx-launcher:hover:not\(:disabled\) \{[^}]*--dsw-interactive-bg-hover/)
  assert.match(source, /\.wbx-launcher\[data-wide="false"\] \{[^}]*width: 36px;[^}]*height: 36px;/)
  assert.match(source, /\.wbx-launcher\[data-wide="false"\] \.wbx-launcher-label \{[^}]*clip: rect\(0 0 0 0\)/)
  assert.match(source, /\.wbx-launcher\[data-wide="false"\] \.wbx-launcher-caret \{[^}]*clip: rect\(0 0 0 0\)/)
  assert.doesNotMatch(source, /\.wbx-launcher\[data-wide="false"\] \.wbx-launcher-icon \{/)
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
  box-shadow: var(--dsw-shadow-lv1, 0 2px 4px rgba(0,0,0,.08)); }
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

