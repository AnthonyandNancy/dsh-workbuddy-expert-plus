# WorkBuddy 三项回归加固实施计划（0.1.2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 DeepSeek Bot 0.2.10（DSH 0.2.1-rc.2）真机上，彻底修复三项原始需求，并让专家数量不再“看起来变少”：
1. Bot 模式创建 Bot 不得再出现 `catalog.readPrompt is not a function`。
2. Agent ↔ Bot 切换时，侧边「WorkBuddy 专家」入口立即出现/消失，不依赖聚焦、可见性或等待。
3. 仅 Bot 模式移除输入框「专家」入口；Agent 模式完整保留。
4. 专家列表显示“内置 39 + 本机可用来源”，并在 UI 明示来源与可安装数量，不再把 39 误认为全部。

**Architecture:** 保持一个包、一个 ModuleLoader id、零构建客户端。把“当前 surface”从依赖 DS-Bot 私有 slot id 的推断，改为**窗口内单调状态机 + 两个 slot 单元联合观测**：DS-Bot 的 shell 组和 conversation 组在切换时先撤后装，状态机在组撤销的空窗期保持上一次的确定状态（Bot 或 Agent），只有出现新的确定证据才迁移，从而消除空窗期误判和聚焦依赖。输入框入口改为**条件注册**：Bot/pending 时真正 dispose 我们的 `conversation.input.left` 条目，Agent 时重新注册，避免 list slot 保留空 cell。创建链路保留 0.1.1 的 unified catalog 修复，并增加**端到端回归测试**直接走生产 `mountBundledMarketRoutes` + 真实 `createBotService` + 真实 bundled catalog，断言不再出现 `readPrompt is not a function`，且编辑后的 prompt 可通过。数量问题只做**呈现与来源修复**，不放宽许可红线：内置仍为 39 个有 prompt 级许可证据的专家，另外把本机 WorkBuddy 来源的可用数量与阻塞原因展示清楚。

**Tech Stack:** Node.js >=20 ESM、`node:test`、DSH Cordis slots（`inject/register/entries/subscribe`）、零构建 `window.__ModuleLoader__.load`、DS-Bot `POST api/bot`、React（宿主提供，无 JSX）。

## Global Constraints

- 单包单 id：`dsh-workbuddy-expert-plus`；不得新增第二个 client bundle 或 Bot fork。
- 不修改 DS-Bot/DSH 源码；不写 DS-Bot 私有 localStorage 值（只读 `ds-bot:surface` 作为提示）。
- 能力探测（`/market/environment`）仍是创建与否的唯一权威；surface 只决定 UI 归属。
- Bot 模式不得渲染输入框「专家」入口；Agent 模式必须原样保留。
- 内置资源只发 `ready + 有 prompt 级许可证据` 的专家；不得把 `license/` 依赖文本当作 prompt 许可。
- 测试先写、先看失败（RED），再写最小实现（GREEN）。
- 真机验证目标：DeepSeek Bot 0.2.10，profile `E:\DSHbot\data\profiles\ds-bot`，DSH home `E:\DSHbot\data`。

---

### Task 1: 用回归测试锁死创建 Bot 的 `readPrompt` 链路

**Files:**
- Test: `packages/dsh-workbuddy-expert-plus/test/bundled-routes.test.js`
- Maybe Modify: `packages/dsh-workbuddy-expert-plus/src/importer/bundled-routes.js`、`src/services/create-bot.js`

**Interfaces:**
- Consumes: `createBundledCatalog({pluginVersion})`、`createUnifiedCatalog({bundled, local, localEnabled:false})`、`createBotService({adapter, api, bindingsPath})`、`mountBundledMarketRoutes(ctx,{catalog, botService})`。
- Produces: 一条真正走 HTTP 路由的 Bot 创建测试：`POST /market/bot/create` → 200 且 `api.calls` 中出现 `create-bot`，`payload.instructions` 等于 `catalog.readPrompt(id)`。

- [ ] **Step 1: 写失败测试**

在 `test/bundled-routes.test.js` 增加（复用现有 fake webServer / fake api 辅助）：

```js
test('bot create through the production route reads a complete bundled prompt', async () => {
  const catalog = createBundledCatalog({ pluginVersion: '0.1.2' })
  const unified = createUnifiedCatalog({ bundled: catalog, local: undefined, localEnabled: false })
  const calls = []
  const botService = createBotService({
    adapter: createBundledSourceAdapter(catalog),
    bindingsPath: undefined,
    api: { async call(endpoint, payload) {
      calls.push({ endpoint, payload })
      if (endpoint === 'state') return { bots: [], models: [{ ref: 'm' }], defaultModel: 'm' }
      if (endpoint === 'create-bot') return { id: 'b1', name: payload.name, instructions: payload.instructions }
      throw new Error(`unexpected ${endpoint}`)
    } },
  })
  const server = fakeServer()
  mountBundledMarketRoutes(server, { catalog: unified, botService })
  const id = (await catalog.stateOf()).experts[0].id
  const response = await callRoute(server, 'POST', '/market/bot/create', { expertId: id, name: 'N', role: 'R', instructions: await catalog.readPrompt(id) })
  assert.equal(response.status, 200)
  assert.equal(calls.filter((c) => c.endpoint === 'create-bot').length, 1)
})
```

- [ ] **Step 2: 运行并确认 RED/GREEN 语义**

Run: `node --test test/bundled-routes.test.js`
Expected: 若生产链路丢失 `readPrompt`，测试以 `catalog.readPrompt is not a function` 失败；0.1.1 上应 PASS（锁住回归）。

- [ ] **Step 3: 仅在失败时做最小修复**

若 RED：确保 `mountBundledMarketRoutes` 的 `catalog` 是 `createUnifiedCatalog(...)` 产物，`unified.readPrompt` 转发生效；不得改 `create-bot` 去直接读文件系统。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/bundled-routes.test.js test/dsbot-creation.test.js`
Expected: 全部 PASS。

---

### Task 2: 用“单调 surface 状态机”替换空窗期误判

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/client/client.js`
- Test: `packages/dsh-workbuddy-expert-plus/test/client-surface.test.js`

**Interfaces:**
- Produces: `createSurfaceStore({storage, subscribe, entries, win, document})` 返回 `{get, subscribe, refresh, dispose}`，内部规则：
  - 订阅 `sidebar.footer.action` **和** `conversation.input.left`。
  - Bot 证据：任一 cell 出现 DS-Bot 的 `bot-account`，或 `conversation.input.left` 出现 `bot-plus`（DS-Bot conversation 组专属）。
  - Agent 证据：`bot-return` 存在且两个 Bot-only 证据都不存在，并且 storage 明确为 `agent`；或两个 cell 都存在 DS-Bot 条目但均非 Bot-only。
  - **空窗保持**：如果本次通知后两个 cell 都没有任何 DS-Bot 条目（组切换的中间态），保持上一次已确定的 `bot` / `agent`，不得回落到 `unknown`/`bot-pending`。
  - 冷启动（从未观测到任何 DS-Bot 条目）：storage `agent` → `agent`；storage `bot` → `bot-pending`；无 → `unknown`。

- [ ] **Step 1: 写失败测试**

在 `test/client-surface.test.js` 增加：

```js
test('a group swap keeps the last surface instead of falling to unknown', async () => {
  const app = surfaceHarness(botOnly, 'bot')
  assert.equal(app.store.get(), 'bot')
  await app.transition([])              // DS-Bot 先撤 shell 组
  assert.equal(app.store.get(), 'bot', 'the empty transition window must not flip the surface')
  await app.transition(agentOnly)       // 再装 agent 组
  await app.storageTransition('agent')
  assert.equal(app.store.get(), 'agent')
  await app.transition([])
  assert.equal(app.store.get(), 'agent', 'Agent→Bot window also holds')
  await app.transition(botOnly)
  assert.equal(app.store.get(), 'bot')
})

test('conversation.input.left bot-plus is a Bot signal on its own', async () => {
  const app = surfaceHarness([], 'agent', [{ options: { id: 'bot-plus' } }])
  assert.equal(app.store.get(), 'bot', 'DS-Bot conversation group proves Bot mode even before shell settles')
})
```

同步扩展 `surfaceHarness` 支持第二个 cell：

```js
function surfaceHarness(footer, storage, conversation = []) {
  // entries(name) returns footer for 'sidebar.footer.action', conversation for 'conversation.input.left'
}
```

（现有测试的第三个参数默认 `[]`，保持兼容。）

- [ ] **Step 2: 验证 RED**

Run: `node --test test/client-surface.test.js`
Expected: 第一条在 `await app.transition([])` 后得到 `unknown`/`bot-pending`，与 `bot` 不等而失败。

- [ ] **Step 3: 最小实现**

在 `client.js` 的 `createSurfaceStore` 中：

```js
var lastSettled = null   // 'bot' | 'agent'
function compute () {
  var hint = botSurfaceHint(storage)
  var footer = readEntries('sidebar.footer.action')
  var convo = readEntries('conversation.input.left')
  var bot = hasEntry(footer, 'bot-account') || hasEntry(convo, 'bot-plus')
  var returnSeen = hasEntry(footer, 'bot-return')
  var dsBotPresent = footer.length > 0 || convo.length > 0
  if (bot) { lastSettled = 'bot'; return 'bot' }
  if (dsBotPresent) {
    if (hint === 'agent') { lastSettled = 'agent'; return 'agent' }
    // footer/conversation 存在但 Bot-only 证据缺席：可能是组切换，也可能是 Agent
    return lastSettled === 'agent' ? 'agent' : 'bot-pending'
  }
  if (lastSettled !== null) return lastSettled   // 组切换空窗：保持
  return hint === 'agent' ? 'agent' : hint === 'bot' ? 'bot-pending' : 'unknown'
}
```

并把 `subscribeSlots` 扩展为同时订阅两个 key（当前实现只订阅一个）。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/client-surface.test.js`
Expected: 全部 PASS，包括原有冷启动、微任务批处理、外来注册者等测试。

---

### Task 3: Bot 模式下**移除**输入框专家条目（条件注册）

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/client/client.js`
- Test: `packages/dsh-workbuddy-expert-plus/test/plugin-lifecycle.test.js`、`test/client-surface.test.js`

**Interfaces:**
- Produces: 一个 `createComposerExpertRegistration({slots, surfaceStore, t, getLocale})`，返回 `{ sync(), dispose() }`：
  - surface `bot` / `bot-pending` → 若已注册则 dispose，条目从 slot ledger 消失。
  - surface `agent` / `unknown` → 若未注册则 `slots.inject('conversation.input.left', () => slots.register(...))`。
  - 组件仍保留 `ComposerExpertSeat` 作为防御性渲染（Agent 时渲染 `ExpertSelector`）。

- [ ] **Step 1: 写失败测试**

在 `test/plugin-lifecycle.test.js` 里，让 `bootClient()` 的 slot stub 记录 `register`/`dispose`，并增加：

```js
test('the composer expert entry leaves the slot ledger in Bot mode', async () => {
  const app = await bootClient({ surface: 'bot' })
  assert.equal(app.registered.has('conversation.input.left:workbuddy-expert'), false,
    'Bot mode must not keep a null-rendering entry in the composer list')
  app.setSurface('agent')
  await app.flush()
  assert.equal(app.registered.has('conversation.input.left:workbuddy-expert'), true,
    'Agent mode re-registers the picker')
})
```

（若现有 `bootClient` 不支持 `surface`，最小扩展为可注入 footer entries + storage。）

- [ ] **Step 2: 验证 RED**

Run: `node --test test/plugin-lifecycle.test.js`
Expected: Bot 模式下条目仍存在（因为当前只在组件里 return null），断言失败。

- [ ] **Step 3: 最小实现**

把现在 `apply()` 中的：

```js
collect(slots.inject('conversation.input.left', function () { return slots.register({...}, ComposerExpertSeat) }))
```

改为条件注册函数，并在 `surfaceStore.subscribe(sync)` 中调用 `sync()`；`collect` 只收集最终 disposer。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/plugin-lifecycle.test.js test/client-surface.test.js`
Expected: 全部 PASS；Agent 模式条目存在，Bot 模式不存在。

---

### Task 4: 市场页显示“内置 + 本机来源”，不再把 39 当作全部

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/client/client.js`（census + 说明文案）
- Modify: `packages/dsh-workbuddy-expert-plus/locale/zh.json`、`locale/en.json`
- Test: `packages/dsh-workbuddy-expert-plus/test/client-bot-ui.test.js`

**Interfaces:**
- Produces: 市场页 census 增加“内置 {bundled} · 本机 {local}”两个计数（来自 `/market/state` 的 `counts`），并在 subtitle 下加一行来源说明：
  - 内置：随包离线可用，已通过许可审核。
  - 本机：来自 WorkBuddy 源目录，仅本机可用；路径不存在时显示 0 并给出设置入口。

- [ ] **Step 1: 写失败测试**

```js
test('the market census separates bundled from local experts', () => {
  assert.match(source, /censusBundled/)
  assert.match(source, /censusLocal/)
  assert.match(source, /counts\.bundled/)
  assert.match(source, /counts\.local/)
})
```

- [ ] **Step 2: 验证 RED**

Run: `node --test test/client-bot-ui.test.js`
Expected: 缺少 `censusBundled` 等键而失败。

- [ ] **Step 3: 最小实现**

- 字典增加 `censusBundled: '内置 {n}'`、`censusLocal: '本机 {n}'`、`sourceBundledHint`、`sourceLocalHint`。
- census 渲染追加两个计数；`stats` 从 `state.counts` 读取，缺省回退到现有计算。
- **不改** `localEnabled:false` 的默认值；本机来源仍由设置里的 `sourcePath` 显式启用（安全默认），但 UI 必须显示本机可用数量与路径状态。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/client-bot-ui.test.js`
Expected: PASS。

---

### Task 5: 升版 0.1.2、重建资源清单、打包、安装到真机 profile

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/package.json`（0.1.2）
- Regenerated: `resources/experts/manifest.json`、`catalog.sha256`、`build/reports/*`
- Build: `packages/dsh-workbuddy-expert-plus/build/dsh-workbuddy-expert-plus-0.1.2.tgz`

- [ ] **Step 1: 全量测试**

Run: `node --test test/*.test.js`
Expected: 全部 PASS（原 68 + 新增）。

- [ ] **Step 2: 重建资源与包报告**

Run: `npm run build:experts && npm run check:package`
Expected: `ok:true`，`ready=39`，`blocked=390`，文件数与资源数一致。

- [ ] **Step 3: 打包**

Run: `pnpm pack --pack-destination build`
Expected: `build/dsh-workbuddy-expert-plus-0.1.2.tgz`。

- [ ] **Step 4: 安装到独立 Bot 真机 profile**

把 `E:\DSHbot\data\profiles\ds-bot\package.json` 的依赖从 `link:` 改为 `file:...0.1.2.tgz`，执行 pnpm install，重启 DeepSeek Bot。
Expected: profile `bundles` 含 `dsh-workbuddy-expert-plus`；`node_modules/dsh-workbuddy-expert-plus/package.json` 版本为 0.1.2（非 symlink）。

- [ ] **Step 5: 真机验证**

1. 打开设置 → WorkBuddy 专家：显示 `内置 39 · 本机 N`，不再只有 39 的误导。
2. Bot 模式打开 WorkBuddy 专家 → 选专家 → 创建：成功，无 `readPrompt` 错误。
3. Bot ↔ Agent 切换：侧边入口立即出现/消失；输入框「专家」仅在 Agent 出现。
4. 记录 `/market/state` 的 `pluginVersion` 为 0.1.2。

---

## Self-Review

- 三项原始需求均有独立失败测试与生产路径断言。
- 空窗保持规则是“单调”的：只有新证据才迁移，不会因组撤销而回落。
- 条件注册解决 list slot 空 cell，比 `return null` 更强。
- 数量问题不放宽许可：39 仍是有证据的内置集；本机来源单独计数并明示。
- 风险：若 DS-Bot 未来把 `bot-plus` 改名，Bot 证据仍有 `bot-account`；两者都改名时退化为 storage 提示，仍不会误删 Agent 功能（unknown 保留选择器）。
