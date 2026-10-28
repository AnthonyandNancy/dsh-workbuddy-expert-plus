# WorkBuddy 专家市场分类、中文标题与 Agent/Bot 卡片一致性实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复 Agent 市场“429 个专家全部未分类、15 个分类只剩未分类、标题显示英文 id”的问题，并让 Bot 市场复用 Agent 市场的专家卡片样式与分类筛选，显示中文专家名称。

**Architecture:** 不新增第二套数据源或第二套卡片组件。把 `/market/state` 已经返回的 `displayName`、`profession`、`description`、`categoryId` 作为唯一权威字段：客户端派生函数同时兼容原有本地扫描字段（`name` / `zhName` / `category`），但优先读取内置目录字段。分类标签使用原始 WorkBuddy `expert_center.json` 中 15 个分类的中英文正式名称。把 Agent 卡片重构为共享的 `ExpertCard`（可注入动作按钮与状态标记），Agent 传入安装/更新/卸载动作，Bot 传入“创建 Bot / 再次创建”动作；Bot 市场补齐分类 chip 行、头像、中文标题、id 副标题、描述、徽标和状态标记。

**Tech Stack:** Node.js >= 20 ESM、`node:test`、零构建客户端 `window.__ModuleLoader__.load`、React（宿主提供，无 JSX）、Cordis slots、DS-Bot 0.2.10、DSH 0.2.1-rc.2。

## Global Constraints

- 单包单 id：`dsh-workbuddy-expert-plus`；不得新增第二个 client bundle 或 Bot fork。
- 不修改 DS-Bot / DSH 源码。
- 内置 429 个专家全部保留；不得重新引入 license / 只读门槛。`license.status` 只作为来源审计信息。
- 分类键必须使用原始 `categoryId`（例如 `08-FinanceInvestment`），不得把中文标签当作过滤键。
- 分类显示必须使用 `expert_center.json` 的正式名称：产品设计、技术工程、游戏空间、数据智能、营销增长、内容创作、销售商务、金融投资、运营人力、项目质量、法务安全、行业顾问、腾讯专区、全球发展、开学季。
- 中文标题必须优先选择含汉字的字段：`displayName`（含汉字）→ `zhName`（含汉字）→ `profession`（含汉字）→ `name`（含汉字）→ `displayName` → `profession` → `id`。不得因为缺少 `name`/`zhName` 就直接显示 id；也不得让 `CloudQ` 等纯英文品牌名成为中文界面的标题。
- 英文标题优先级：`name` → `displayName` → `profession` → `id`（保留原有本地扫描行为）。
- Bot 卡片必须复用 Agent 卡片组件与 `MARKET_CSS`，不得再维护第二套 `wbx-card` 内联结构。
- Bot 专属动作不得误用 Agent 安装动作：Bot 卡片按钮只允许“创建 Bot / 再次创建”，不得出现安装/卸载。
- Bot 创建仍以 `/market/environment` 的 `status === 'ready'` 为唯一放行条件；`readOnly` / `unknown` / `incompatible` 一律禁用。
- Bot 创建继续提交完整 prompt，并携带 `basePromptSha256`；不得截断或改写 prompt。
- 测试先写、先看失败（RED），再写最小实现（GREEN）；每个任务结束前运行指定测试。
- 真机验证目标：DS-Bot 0.2.10，DSH home `E:\DSHbot\data`，profile `E:\DSHbot\data\profiles\ds-bot`。

---

## Root Cause Evidence

已在分支 `feat/market-categories-cn-titles` 上用真实 `resources/experts/manifest.json` 复现：

```json
{
  "rawCardFields": {
    "displayName": "40-20 外卖券",
    "profession": "美团生活助手",
    "categoryId": "07-SalesCommerce"
  },
  "currentCategoryOf": "",
  "currentNameZh": "meituan-living-assistant-meituan-living-assistant",
  "chipCount": 1,
  "chips": [{ "id": "·uncategorized·", "count": 429 }],
  "knownLabels": 6
}
```

对应代码缺陷：

1. `client/client.js` 的 `categoryOf()` 只读 `expert.category`，而 `/market/state` 的内置卡片只有 `categoryId`；`categoryKeyOf`、`categoryChipsOf`、`filterExperts`、搜索 haystack、Census 分类数全部由此派生的 `''` 污染。
2. `KNOWN_CATEGORY_LABELS` 只有 6 个分类，真实目录有 15 个。
3. `localeNameOf()` 只读 `zhName` / `name`，而内置卡片只有 `displayName`；中文模式下因此回退到 `id`。
4. `BotMarketOverlay()` 自己内联渲染 `li.wbx-card`，只输出名称、id、描述和一个安装样式的按钮；没有头像、徽标、状态标记、分类 chips，也没有复用 Agent 的 `ExpertCard`。

数据侧已证实完整：

- `manifest.json`：429 个专家，0 个缺 `displayName`、0 个缺 `profession`、0 个缺 `description`、0 个缺 `categoryId`。
- 15 个 `categoryId` 全部非空，覆盖 429 个专家。
- `expert_center.json` 提供 15 个分类的权威中英文名称。
- 30 个专家的 `displayName` 不含汉字（如 `CloudQ`、`AndonQ`），但 30 个全部有中文 `profession`；中文标题必须先选含汉字的字段，否则这 30 张卡片仍是英文标题。

---

## File Structure

- `client/client.js` — 唯一客户端 bundle。修改派生函数、分类标签、共享卡片组件、Agent 页面、Bot overlay。
- `scripts/smoke-client.mjs` — 离线组件级 smoke；增加中文标题、15 分类、Bot 卡片一致性断言。
- `test/client-market-cards.test.js`（新建）— 使用真实 manifest 与 vm 沙箱的客户端派生/渲染回归测试。
- `test/client-bot-ui.test.js` — 增加 Bot 卡片复用与创建动作断言。
- `test/bundled-routes.test.js` — 锁定 `/market/state` 返回 `displayName` / `categoryId` / `avatarFile`，防止服务端未来把字段改名。
- `package.json` — 版本升至 `0.2.1`，让真机安装可区分新旧包。
- `build/dsh-workbuddy-expert-plus-0.2.1.tgz` — 最终交付物。

---

### Task 1: 锁定真实目录字段与 15 分类契约

**Files:**
- Create: `test/client-market-cards.test.js`
- Test: `test/bundled-routes.test.js`

**Interfaces:**
- Consumes: `resources/experts/manifest.json`、`expert_center.json`（测试只读）、`mountBundledMarketRoutes()`。
- Produces: 一个可复用的客户端 vm 加载器 `loadClient()`，返回 `module`；后续任务共用。

- [ ] **Step 1: 写服务端字段契约的失败测试**

在 `test/bundled-routes.test.js` 末尾追加：

```js
test('market state keeps the fields the market cards render', async () => {
  const server = fakeServer()
  mountBundledMarketRoutes(server, { catalog, botEnabled: false })
  const response = res()
  await server.routes.get('exact /dsh-workbuddy-expert-plus/api/market/state').handler(
    req({ url: '/dsh-workbuddy-expert-plus/api/market/state' }), response,
  )
  assert.equal(response.status, 200)
  const expert = response.body.experts.find((entry) =>
    entry.id === 'meituan-living-assistant-meituan-living-assistant')
  assert.equal(expert.displayName, '40-20 外卖券')
  assert.equal(expert.profession, '美团生活助手')
  assert.equal(expert.categoryId, '07-SalesCommerce')
  assert.equal(expert.avatarFile,
    'meituan-living-assistant-meituan-living-assistant/avatar.jpg')
  assert.equal(expert.name, undefined)
  assert.equal(expert.category, undefined,
    'bundled cards use displayName/categoryId; the client must read those names')
})
```

- [ ] **Step 2: 运行并确认测试基线**

```bash
node --test test/bundled-routes.test.js
```

Expected: 新增测试 PASS（字段本来就在），但后续客户端测试会 FAIL。保留此断言作为服务端契约锁。

- [ ] **Step 3: 创建客户端测试加载器与失败测试**

新建 `test/client-market-cards.test.js`：

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(root, 'client', 'client.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'resources', 'experts', 'manifest.json'), 'utf8'))
const center = JSON.parse(readFileSync(join(root, '..', '..', 'workbuddyskills-main', 'experts', 'expert_center.json'), 'utf8'))

function loadClient() {
  let definition
  const React = {
    createElement(type, props, ...children) { return { type, props: props || {}, children: children.flat(Infinity) } },
    useState(value) { return [typeof value === 'function' ? value() : value, () => {}] },
    useEffect() {},
    useRef(value) { return { current: value } },
    Fragment: 'Fragment',
  }
  const sandbox = {
    window: {
      __ModuleLoader__: { load(value) { definition = value } },
      localStorage: { getItem() { return null } },
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
      querySelector: () => null,
      head: { appendChild() {} },
    },
    console, setTimeout, clearTimeout, React,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client/client.js' })
  return { module: definition.factory(() => React), React, sandbox }
}

const meituan = manifest.experts.find((expert) =>
  expert.id === 'meituan-living-assistant-meituan-living-assistant')

test('bundled cards derive the authoritative categoryId', () => {
  const { module } = loadClient()
  assert.equal(module.categoryOf(meituan), '07-SalesCommerce')
  assert.equal(module.categoryKeyOf(meituan), '07-SalesCommerce')
})

test('every bundled expert lands in one of the 15 original categories', () => {
  const { module } = loadClient()
  const chips = module.categoryChipsOf(manifest.experts)
  assert.equal(chips.length, 15)
  assert.equal(chips.some((chip) => chip.id === module.NO_CATEGORY), false)
  assert.equal(chips.reduce((sum, chip) => sum + chip.count, 0), 429)
  assert.deepEqual(chips.map((chip) => chip.id).sort(), center.categories.map((entry) => entry.id).sort())
})

test('category labels are the original 15 Chinese names', () => {
  const { module } = loadClient()
  assert.equal(Object.keys(module.KNOWN_CATEGORY_LABELS).length, 15)
  const expected = {
    '01-ProductDesign': '产品设计',
    '02-Engineering': '技术工程',
    '03-GameSpatial': '游戏空间',
    '04-DataAI': '数据智能',
    '05-MarketingGrowth': '营销增长',
    '06-ContentCreative': '内容创作',
    '07-SalesCommerce': '销售商务',
    '08-FinanceInvestment': '金融投资',
    '09-OperationsHR': '运营人力',
    '10-ProjectQuality': '项目质量',
    '11-SecurityCompliance': '法务安全',
    '12-IndustryConsultant': '行业顾问',
    '13-TencentZone': '腾讯专区',
    '14-GlobalDevelopment': '全球发展',
    '15-BackToSchool': '开学季',
  }
  for (const [id, zh] of Object.entries(expected)) {
    assert.equal(module.categoryLabelOf(id, 'zh'), zh, id)
  }
})

test('Chinese card titles prefer a Chinese field, never the id', () => {
  const { module } = loadClient()
  assert.equal(module.localeNameOf(meituan, 'zh'), '40-20 外卖券')
  assert.equal(module.localeNameOf(meituan, 'en'), '40-20 外卖券')
  assert.equal(module.localeNameOf({ id: 'x', displayName: 'CloudQ', profession: '腾讯云SRE专家' }, 'zh'),
    '腾讯云SRE专家', 'a pure-English brand yields to the Chinese profession')
  assert.equal(module.localeNameOf({ id: 'x', displayName: 'CloudQ' }, 'zh'), 'CloudQ',
    'a brand with no Chinese alternative is preserved rather than replaced by the id')
  assert.equal(module.localeNameOf({ id: 'legacy', zhName: '旧名', name: 'Old' }, 'zh'), '旧名',
    'legacy local cards keep working')
})

test('every bundled expert gets a Chinese title', () => {
  const { module } = loadClient()
  const english = manifest.experts.filter((expert) =>
    !/[\u3400-\u9fff]/.test(module.localeNameOf(expert, 'zh')))
  assert.deepEqual(english, [], 'no expert title is left in English')
})
```

- [ ] **Step 4: 运行并确认 RED**

```bash
node --test test/client-market-cards.test.js
```

Expected: FAIL，至少 4 个断言失败——`categoryOf` 期望 `07-SalesCommerce` 得到 `''`；chips 为 1 个未分类；标签只有 6 个；`localeNameOf` 返回 id。

- [ ] **Step 5: 提交测试**

```bash
git add test/client-market-cards.test.js test/bundled-routes.test.js
git commit -m "test: lock market category and Chinese title contracts"
```

---

### Task 2: 修复分类派生与完整 15 分类标签

**Files:**
- Modify: `client/client.js:1234-1305`
- Test: `test/client-market-cards.test.js`

**Interfaces:**
- Consumes: 卡片上的 `categoryId`（内置）或 `category`（本地扫描）。
- Produces:
  - `categoryOf(expert): string` — 优先 `categoryId`，回退 `category`。
  - `KNOWN_CATEGORY_LABELS` — 15 个正式中英文标签。
  - `categoryLabelOf(raw, localeId)` / `categoryChipsOf(experts)` / `filterExperts(...)` 行为不变，但使用修复后的键。

- [ ] **Step 1: 最小实现分类字段归一**

将 `client/client.js` 中 `KNOWN_CATEGORY_LABELS` 与 `categoryOf` 替换为：

```js
/** The original WorkBuddy marketplace taxonomy (expert_center.json v1.0.0). */
var KNOWN_CATEGORY_LABELS = {
  '01-ProductDesign': { zh: '产品设计', en: 'Product Design' },
  '02-Engineering': { zh: '技术工程', en: 'Engineering' },
  '03-GameSpatial': { zh: '游戏空间', en: 'Game & Spatial' },
  '04-DataAI': { zh: '数据智能', en: 'Data & AI' },
  '05-MarketingGrowth': { zh: '营销增长', en: 'Marketing Growth' },
  '06-ContentCreative': { zh: '内容创作', en: 'Content Creative' },
  '07-SalesCommerce': { zh: '销售商务', en: 'Sales Commerce' },
  '08-FinanceInvestment': { zh: '金融投资', en: 'Finance Investment' },
  '09-OperationsHR': { zh: '运营人力', en: 'Operations HR' },
  '10-ProjectQuality': { zh: '项目质量', en: 'Project Quality' },
  '11-SecurityCompliance': { zh: '法务安全', en: 'Security Compliance' },
  '12-IndustryConsultant': { zh: '行业顾问', en: 'Industry Consultant' },
  '13-TencentZone': { zh: '腾讯专区', en: 'Tencent Zone' },
  '14-GlobalDevelopment': { zh: '全球发展', en: 'Global Development' },
  '15-BackToSchool': { zh: '开学季', en: 'Back to School' }
}

/**
 * The card's raw category key. Bundled cards carry the catalog's `categoryId`;
 * local WorkBuddy scans have historically carried `category`. Reading both at
 * the SOURCE keeps every downstream chip, count and search in agreement.
 */
function categoryOf (expert) {
  if (expert === null || typeof expert !== 'object') return ''
  return strOf(expert.categoryId) || strOf(expert.category)
}
```

- [ ] **Step 2: 运行客户端分类测试**

```bash
node --test test/client-market-cards.test.js
```

Expected: 分类相关 3 个测试 PASS；标题测试仍 FAIL。

- [ ] **Step 3: 补充分类搜索与筛选回归测试**

在 `test/client-market-cards.test.js` 追加：

```js
test('category chips stack with search and status filters', () => {
  const { module } = loadClient()
  assert.deepEqual(
    module.filterExperts(manifest.experts, 'all', '', '08-FinanceInvestment')
      .map((expert) => expert.id).length,
    39,
  )
  assert.deepEqual(
    module.filterExperts(manifest.experts, 'all', '金融投资', 'all')
      .map((expert) => expert.categoryId)
      .filter((id) => id !== '08-FinanceInvestment'),
    [],
    'a Chinese category query matches only that category',
  )
})
```

- [ ] **Step 4: 运行并确认 GREEN**

```bash
node --test test/client-market-cards.test.js
```

Expected: 新增分类测试 PASS，共计 4 个 PASS；标题测试仍 FAIL。

- [ ] **Step 5: 提交**

```bash
git add client/client.js test/client-market-cards.test.js
git commit -m "fix: read bundled categoryId and restore all 15 category labels"
```

---

### Task 3: 中文标题派生修复

**Files:**
- Modify: `client/client.js:1187-1196`、`client/client.js:1298-1305`
- Test: `test/client-market-cards.test.js`
- Test: `scripts/smoke-client.mjs:460-463`

**Interfaces:**
- Consumes: `displayName` / `profession` / `zhName` / `name` / `id`。
- Produces: `localeNameOf(expert, localeId)` 与 `haystackOf(expert)` 同时包含中文标题，使搜索“外卖券”能命中卡片。

- [ ] **Step 1: 实现名称优先级**

将 `localeNameOf` 替换为：

```js
/** True when a title carries at least one Han character. */
var HAN_RE = /[\u3400-\u9fff]/

/**
 * The card title under one UI language.
 *
 * Bundled catalog cards carry a single `displayName` and a `profession`;
 * legacy local scans carry `zhName` / `name`. In zh, a Chinese field always
 * wins over an English brand name (e.g. "CloudQ" → "腾讯云SRE专家"); if no
 * field carries Chinese, the best human-readable name is kept rather than
 * replacing it with the machine id. en keeps the legacy base-name order.
 */
function localeNameOf (expert, localeId) {
  var displayName = strOf(expert.displayName)
  var zhName = strOf(expert.zhName)
  var baseName = strOf(expert.name)
  var profession = strOf(expert.profession)
  var zhFields = [displayName, zhName, profession, baseName]
  var pick
  if (localeId === 'zh') {
    pick = ''
    for (var i = 0; i < zhFields.length; i++) {
      if (HAN_RE.test(zhFields[i])) { pick = zhFields[i]; break }
    }
    if (pick === '') pick = displayName || zhName || baseName || profession
  } else {
    pick = baseName || displayName || profession
  }
  return pick !== '' ? pick : strOf(expert.id)
}
```

- [ ] **Step 2: 让搜索命中中文标题与职业**

将 `haystackOf` 替换为：

```js
/** The search haystack of one card: every human-facing name, id, description, category. */
function haystackOf (expert) {
  return [strOf(expert.id), strOf(expert.displayName), strOf(expert.profession),
    strOf(expert.name), strOf(expert.zhName),
    strOf(expert.description), strOf(expert.zhDescription), strOf(expert.pluginDir),
    (Array.isArray(expert.skills) ? expert.skills : []).join(' '),
    categoryHayshare(categoryOf(expert))].join(' ').toLowerCase()
}
```

- [ ] **Step 3: 增加搜索回归断言**

在 `test/client-market-cards.test.js` 追加：

```js
test('search matches the Chinese title and profession', () => {
  const { module } = loadClient()
  assert.deepEqual(
    module.filterExperts(manifest.experts, 'all', '外卖券', 'all')
      .map((expert) => expert.id),
    ['meituan-living-assistant-meituan-living-assistant'],
  )
  assert.ok(
    module.filterExperts(manifest.experts, 'all', '美团生活助手', 'all')
      .some((expert) => expert.id === 'meituan-living-assistant-meituan-living-assistant'),
  )
})
```

- [ ] **Step 4: 更新旧 smoke 的标题断言**

把 `scripts/smoke-client.mjs` 中：

```js
assert.equal(mod.localeNameOf({ id: 'x', name: 'Coder', zhName: '程序员' }, 'zh'), '程序员')
assert.equal(mod.localeNameOf({ id: 'x', name: 'Coder', zhName: '程序员' }, 'en'), 'Coder')
assert.equal(mod.localeNameOf({ id: 'x', name: 'Coder' }, 'zh'), 'Coder', 'zh falls back to the base name')
assert.equal(mod.localeNameOf({ id: 'x' }, 'en'), 'x', 'the id is the terminal name fallback')
```

替换为：

```js
assert.equal(mod.localeNameOf({ id: 'x', name: 'Coder', zhName: '程序员' }, 'zh'), '程序员')
assert.equal(mod.localeNameOf({ id: 'x', name: 'Coder', zhName: '程序员' }, 'en'), 'Coder')
assert.equal(mod.localeNameOf({ id: 'x', name: 'Coder' }, 'zh'), 'Coder', 'zh falls back to the base name')
assert.equal(mod.localeNameOf({ id: 'x', displayName: '40-20 外卖券' }, 'zh'), '40-20 外卖券',
  'a bundled displayName is the Chinese title')
assert.equal(mod.localeNameOf({ id: 'x', displayName: 'CloudQ', profession: '腾讯云SRE专家' }, 'zh'), '腾讯云SRE专家',
  'a pure-English brand yields to its Chinese profession')
assert.equal(mod.localeNameOf({ id: 'x' }, 'en'), 'x', 'the id is the terminal name fallback')
```

- [ ] **Step 5: 运行并确认 GREEN**

```bash
node --test test/client-market-cards.test.js
node scripts/smoke-client.mjs
```

Expected: 6 个客户端测试全部 PASS；smoke-client 无断言失败。

- [ ] **Step 6: 提交**

```bash
git add client/client.js test/client-market-cards.test.js scripts/smoke-client.mjs
git commit -m "fix: show Chinese expert titles from displayName"
```

---

### Task 4: 抽出可复用的专家卡片

**Files:**
- Modify: `client/client.js:1520-1615`（`ExpertCard`）
- Test: `test/client-bot-ui.test.js`
- Test: `test/client-market-cards.test.js`

**Interfaces:**
- Consumes: `expert`、`t`、`localeId`、`avatarUrl`。
- Produces: `ExpertCard(props)` 新增以下可选 props：
  - `actionLabel: string` — 直接渲染一个动作按钮（Bot 使用）。
  - `onAction: function(expert)` — 点击该按钮。
  - `actionDisabled: boolean`、`actionTitle: string`。
  - `mark: ReactNode` — 额外的卡片状态标记（例如“✓ 已创建”）。
  - 不传 `actionLabel` 时保持现有 Agent 安装/更新/卸载行为完全不变。

- [ ] **Step 1: 写卡片复用失败测试**

在 `test/client-bot-ui.test.js` 追加：

```js
test('ExpertCard renders one injectable action and an optional mark', async () => {
  const vm = await import('node:vm')
  let definition
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { definition = value } }, localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ dataset: {}, textContent: '', remove() {} }), querySelector: () => null, head: { appendChild() {} } },
    console, setTimeout, clearTimeout, React,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const module = definition.factory(() => React)
  const calls = []
  const tree = module.ExpertCard({
    t: (key) => key,
    localeId: 'zh',
    expert: { id: 'e1', displayName: '40-20 外卖券', profession: '美团生活助手', description: 'D', categoryId: '07-SalesCommerce' },
    actionLabel: '创建 Bot',
    onAction: (expert) => calls.push(expert.id),
    mark: '✓ 已创建',
  })
  const text = JSON.stringify(tree)
  assert.match(text, /40-20 外卖券/)
  assert.match(text, /创建 Bot/)
  assert.match(text, /已创建/)
  assert.match(text, /销售商务/)
  assert.doesNotMatch(text, /安装/, 'a Bot card must not expose Agent install')
})
```

- [ ] **Step 2: 运行并确认 RED**

```bash
node --test test/client-bot-ui.test.js
```

Expected: FAIL——当前 `ExpertCard` 不识别 `actionLabel`，且仍渲染安装按钮。

- [ ] **Step 3: 最小实现共享动作插槽**

在 `ExpertCard` 内替换动作构造段：

```js
  var actions = cardActionsOf(expert)
  var rowKey = 'expert:' + strOf(expert.id)
  var injected = typeof props.actionLabel === 'string' && props.actionLabel !== ''
  var cardMark = props.mark !== undefined && props.mark !== null ? props.mark : null
```

把返回树中的 corner 与 foot 改为：

```js
    el('div', { className: 'wbx-corner' },
      injected
        ? el('div', { className: 'wbx-actions' },
            el('button', {
              className: 'wbx-btn', type: 'button',
              'data-variant': 'primary',
              disabled: props.actionDisabled === true,
              title: props.actionTitle || undefined,
              onClick: function () {
                if (typeof props.onAction === 'function') props.onAction(expert)
              }
            }, props.actionLabel))
        : el(ActionRow, {
            t: t,
            rowKey: rowKey,
            actions: actions,
            laneBusy: props.laneBusy === true,
            busyKey: props.busyKey || '',
            confirmKey: props.confirmKey || '',
            onConfirm: function (action) {
              if (typeof props.onActionConfirm === 'function') props.onActionConfirm(rowKey + ':' + action)
            },
            onCancelConfirm: function () {
              if (typeof props.onCancelConfirm === 'function') props.onCancelConfirm()
            },
            onAction: function (action) {
              if (typeof props.onAction === 'function') props.onAction(expert, action)
            }
          })),
```

把 foot 改为：

```js
    (marks.length > 0 || cardMark !== null)
      ? el('div', { className: 'wbx-foot' },
          el('div', { className: 'wbx-status' },
            marks,
            cardMark !== null
              ? el('span', { className: 'wbx-mark', 'data-kind': 'ok' }, cardMark)
              : null))
      : null
```

- [ ] **Step 4: 运行并确认 GREEN**

```bash
node --test test/client-bot-ui.test.js test/client-market-cards.test.js
node scripts/smoke-client.mjs
```

Expected: 全部 PASS；Agent 的 `cardActionsOf` 行为不变。

- [ ] **Step 5: 提交**

```bash
git add client/client.js test/client-bot-ui.test.js
git commit -m "refactor: make ExpertCard action and status injectable"
```

---

### Task 5: Bot 市场复用 Agent 卡片与分类 chip

**Files:**
- Modify: `client/client.js:2627-2835`（`BotMarketOverlay`）
- Test: `test/client-bot-ui.test.js`

**Interfaces:**
- Consumes: `/market/state` 的 `experts`、`avatarFile`、`categoryId`、`botCreated`；`ExpertCard` 的 `actionLabel` / `onAction` / `mark`。
- Produces: Bot 浏览视图包含：
  - 搜索框；
  - 分类 chip 行（`全部分类` + 15 个真实分类 + 未分类，仅在有未分类时出现）；
  - `ul.wbx-grid` 中每个专家一个 `ExpertCard`；
  - 卡片头像来自 `avatarFile`；
  - 卡片标题为中文；
  - 卡片按钮为“创建 Bot / 再次创建”；
  - `botCreated` 时显示“✓ 已创建”。

- [ ] **Step 1: 写 Bot 视图失败测试**

在 `test/client-bot-ui.test.js` 追加渲染测试。为便于断言，使用能保留 hooks 的 React stub 与预置 fetch：

```js
test('Bot market renders the same card anatomy and category chips as Agent', async () => {
  const vm = await import('node:vm')
  let definition
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
  }
  const state = {
    experts: [
      {
        id: 'meituan-living-assistant-meituan-living-assistant',
        displayName: '40-20 外卖券',
        profession: '美团生活助手',
        description: '帮您一键领取美团优惠券',
        categoryId: '07-SalesCommerce',
        avatarFile: 'meituan-living-assistant-meituan-living-assistant/avatar.jpg',
        botCreated: false,
      },
      {
        id: 'uae-public-affairs-uae-public-affairs',
        displayName: '阿联酋公共事务专家',
        profession: '公共事务顾问',
        description: '专注阿联酋政府关系',
        categoryId: '14-GlobalDevelopment',
        avatarFile: 'uae-public-affairs-uae-public-affairs/avatar.png',
        botCreated: true,
      },
    ],
  }
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { definition = value } }, localStorage: { getItem: () => null }, addEventListener() {}, removeEventListener() {} },
    document: { createElement: () => ({ dataset: {}, textContent: '', remove() {} }), querySelector: () => null, head: { appendChild() {} } },
    console, setTimeout, clearTimeout, React,
    fetch: async (url) => ({
      ok: true, status: 200,
      async json() {
        if (String(url).includes('/market/state')) return state
        if (String(url).includes('/market/environment')) return { status: 'ready', state: { bots: [], models: [] } }
        throw new Error(`unexpected ${url}`)
      },
    }),
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const module = definition.factory(() => React)
  module.openBotMarket()
  const tree = module.BotMarketOverlay({ t: (key) => key, localeId: 'zh', onClose() {} })
  const text = JSON.stringify(tree)
  assert.match(text, /40-20 外卖券/)
  assert.match(text, /阿联酋公共事务专家/)
  assert.match(text, /销售商务/)
  assert.match(text, /全球发展/)
  assert.match(text, /创建 Bot/)
  assert.match(text, /再次创建/)
  assert.match(text, /wbx-avatar/)
  assert.match(text, /wbx-badge/)
  assert.match(text, /wbx-id/)
  assert.match(text, /wbx-catrow/)
  assert.doesNotMatch(text, /安装/)
})
```

- [ ] **Step 2: 运行并确认 RED**

```bash
node --test test/client-bot-ui.test.js
```

Expected: FAIL——Bot 当前无 `wbx-avatar`、无 `wbx-badge`、无 `wbx-catrow`、标题直接取 `displayName` 但无分类标签，且按钮文本是 `botCreateBtn` 占位键（测试里 `t` 为恒等函数）。

- [ ] **Step 3: 在 Bot overlay 中派生分类与过滤**

在 `BotMarketOverlay` 的 `filtered` 之前加入：

```js
  var categoryState = React.useState('all')
  var setCategory = categoryState[1]
  var category = categoryState[0]
  var cards = experts.map(function (expert) {
    var card = Object.assign({}, expert)
    if (strOf(card.avatarFile) !== '') {
      card.avatarUrl = API_BASE + '/market/avatar?id=' + encodeURIComponent(strOf(card.id))
    }
    return card
  })
  var categoryChips = categoryChipsOf(cards)
  var filtered = filterExperts(cards, 'all', query, category)
```

删除旧的 `q` / `filtered` 实现，避免双重过滤。

- [ ] **Step 4: 用共享卡片和分类 chip 替换 Bot 内联列表**

把 Bot 的 `selected === null` 浏览分支改为：

```js
      selected === null
        ? el('div', { className: 'wbx-modal-body' },
            el('input', {
              className: 'wbx-search', type: 'search', value: query,
              placeholder: t('search'),
              onChange: function (event) { setQuery(event.target.value) }
            }),
            !loading && categoryChips.length > 0
              ? el('div', { className: 'wbx-catrow', role: 'group', 'aria-label': t('categoryRowLabel') },
                  el('button', {
                    key: 'all', className: 'wbx-chip', type: 'button',
                    'aria-pressed': category === 'all' ? 'true' : 'false',
                    'data-active': category === 'all' ? 'true' : undefined,
                    onClick: function () { setCategory('all') }
                  },
                    t('categoryAll'),
                    el('span', { className: 'wbx-chip-count' }, String(cards.length))),
                  categoryChips.map(function (chip) {
                    var active = category === chip.id
                    var label = chip.id === NO_CATEGORY ? t('categoryNone') : categoryLabelOf(chip.id, localeId)
                    return el('button', {
                      key: chip.id, className: 'wbx-chip', type: 'button',
                      title: chip.id === NO_CATEGORY ? undefined : chip.id,
                      'aria-pressed': active ? 'true' : 'false',
                      'data-active': active ? 'true' : undefined,
                      onClick: function () { setCategory(chip.id) }
                    },
                      el('span', { className: 'wbx-chip-label' }, label),
                      el('span', { className: 'wbx-chip-count' }, String(chip.count)))
                  }))
              : null,
            el('ul', { className: 'wbx-grid' },
              filtered.map(function (expert) {
                return el(ExpertCard, {
                  key: strOf(expert.id),
                  t: t,
                  expert: expert,
                  localeId: localeId,
                  actionLabel: expert.botCreated === true ? t('botAgainBtn') : t('botCreateBtn'),
                  actionDisabled: !ready,
                  actionTitle: ready ? undefined : statusText,
                  onAction: function (card) { choose(card) },
                  mark: expert.botCreated === true ? t('botCreatedStamp') : null,
                })
              })))
        : el('div', { className: 'wbx-modal-body' },
```

同时在该组件顶部声明加载标记：

```js
  var loading = body === null
```

- [ ] **Step 5: 运行并确认 GREEN**

```bash
node --test test/client-bot-ui.test.js
node scripts/smoke-client.mjs
```

Expected: PASS；Bot 卡片与 Agent 同样具备 avatar/name/id/desc/badges/mark；按钮只出现创建动作。

- [ ] **Step 6: 提交**

```bash
git add client/client.js test/client-bot-ui.test.js
git commit -m "feat: render Bot market with the Agent expert card"
```

---

### Task 6: 版本升级、完整回归与打包

**Files:**
- Modify: `package.json`
- Modify: `docs/verification-report.md`
- Build: `build/dsh-workbuddy-expert-plus-0.2.1.tgz`

**Interfaces:**
- Produces: 一个可安装的 0.2.1 包，包含全部 429 个专家与修复后的客户端。

- [ ] **Step 1: 升版本**

把 `package.json` 的 `"version": "0.2.0"` 改为 `"version": "0.2.1"`。

- [ ] **Step 2: 重建资源清单**

```bash
npm run build:experts
```

Expected: 输出 `ready: 429`、`blocked: 0`，并重写 `resources/experts/manifest.json` 中的 `pluginVersion: "0.2.1"`。

- [ ] **Step 3: 运行完整测试**

```bash
npm test
```

Expected: `node --test` 全部 PASS，随后 smoke / smoke-client / smoke-importer / smoke-install 全部通过。

- [ ] **Step 4: 打包校验**

```bash
npm run check:package
```

Expected: 生成 `build/dsh-workbuddy-expert-plus-0.2.1.tgz`；文件数约 5987，专家 429，资源 5946，所有 hash 匹配，离线加载成功。

- [ ] **Step 5: 记录验证结果**

在 `docs/verification-report.md` 增加一节，写入：

- 分支 `feat/market-categories-cn-titles`；
- 客户端测试通过数量；
- `ready: 429`、`blocked: 0`；
- tgz 路径与 SHA-256；
- 真机验证结论（Task 7 完成后补）。

- [ ] **Step 6: 提交**

```bash
git add package.json resources/experts/manifest.json docs/verification-report.md
git commit -m "chore: release 0.2.1 with market category and card fixes"
```

---

### Task 7: 真机验证 Agent 与 Bot 两个市场

**Files:**
- No source changes expected.
- Evidence: screenshots + DOM extraction saved under `.tmp-dsbot/`.

**Interfaces:**
- Consumes: `build/dsh-workbuddy-expert-plus-0.2.1.tgz`。
- Produces: 真实 DS-Bot 0.2.10 上的验收证据。

- [ ] **Step 1: 安装 0.2.1 到真机 profile**

```bash
cd 'E:/DSHbot/data/profiles/ds-bot'
rm -rf node_modules/dsh-workbuddy-expert-plus
pnpm add -D 'D:/code/ai/dsh-workbuddy-expert/packages/dsh-workbuddy-expert-plus/build/dsh-workbuddy-expert-plus-0.2.1.tgz' --force
```

Expected: `package.json` 中版本为 `0.2.1`；`resources/experts/manifest.json` 中 `pluginVersion: "0.2.1"`、`ready: 429`。

- [ ] **Step 2: 启动真实宿主**

```bash
cd 'D:/code/ai/DeepSeek-Bot/BotCode/DeepSeek-Bot-main'
node app/src/host.mjs
```

Expected: 输出本地 URL 与 token；无 `readOnly` / 「另一个 dsh 中打开」错误。

- [ ] **Step 3: Agent 模式 DOM 验收**

用 `playwright-cli` 打开带 token 的 URL，进入「设置 → WorkBuddy 专家」，执行并保存：

```js
({
  chips: [...document.querySelectorAll('.wbx-catrow .wbx-chip')].map((node) => node.textContent.trim()),
  uncategorized: [...document.querySelectorAll('.wbx-catrow .wbx-chip')]
    .some((node) => node.textContent.includes('未分类')),
  firstName: document.querySelector('.wbx-card .wbx-name')?.textContent,
  firstId: document.querySelector('.wbx-card .wbx-id')?.textContent,
  cardCount: document.querySelectorAll('.wbx-card').length,
})
```

Expected:

- 分类 chip 数为 16（“全部分类” + 15 个分类）；
- 不存在“未分类 429”；
- `firstName` 是中文（例如 `40-20 外卖券`），不等于 `firstId`；
- `cardCount === 429`；
- 每张卡片有 `.wbx-avatar` 或头像 emoji 占位、`.wbx-badge[data-kind="category"]`。

- [ ] **Step 4: 点击一个分类并截图**

点击「金融投资」chip，断言：

```js
({
  active: document.querySelector('.wbx-catrow .wbx-chip[data-active="true"]')?.textContent.trim(),
  cards: document.querySelectorAll('.wbx-card').length,
})
```

Expected: `active` 包含「金融投资」，`cards === 39`。

- [ ] **Step 5: Bot 模式 DOM 验收**

切到 Bot 模式，打开侧边「WorkBuddy 专家」，执行同一段 DOM 提取。Expected:

- 分类 chip 数为 16；
- 卡片标题为中文；
- 每张卡片有 `.wbx-avatar`、`.wbx-id`、`.wbx-desc`、`.wbx-badge[data-kind="category"]`；
- 每张卡片按钮文本为「创建 Bot」或「再次创建」；
- 页面不存在「安装」按钮；
- 卡片布局与 Agent 模式截图一致（两列网格、卡片内边距、头像 40px、标题 13px）。

- [ ] **Step 6: 创建 Bot 端到端复验**

在 Bot 市场选择「40-20 外卖券」，确认名称为中文、角色为「美团生活助手」，创建后断言：

```js
({
  notice: document.querySelector('.wbx-notice[data-kind="ok"]')?.textContent,
  createdMark: [...document.querySelectorAll('.wbx-card')]
    .find((card) => card.textContent.includes('40-20 外卖券'))
    ?.textContent.includes('已创建'),
})
```

Expected: `notice` 包含 `Bot 创建成功`，`createdMark === true`；DS-Bot 侧边栏出现同名 Bot。

- [ ] **Step 7: 记录真机证据并提交**

把 DOM JSON 与两张截图路径写入 `docs/verification-report.md`，然后：

```bash
git add docs/verification-report.md
git commit -m "docs: record 0.2.1 real-device market verification"
```

---

## Verification Checklist

- [ ] `node --test test/client-market-cards.test.js` 全部通过。
- [ ] Agent 市场分类 chip = 16（全部 + 15 分类），未分类不存在。
- [ ] `categoryOf()` 对内置卡片返回原始 `categoryId`，对旧本地卡片仍返回 `category`。
- [ ] 429 个专家全部落入 15 个分类，计数总和为 429。
- [ ] 中文标题优先 `displayName`，不以 id 作为可见标题。
- [ ] 30 个 ASCII 品牌名保持原样，不强行改写。
- [ ] 搜索“外卖券”和“美团生活助手”都能命中同一张卡片。
- [ ] Bot 市场复用 `ExpertCard`，有头像、中文标题、id、描述、分类徽标、分类 chip。
- [ ] Bot 卡片只出现「创建 Bot / 再次创建」，不出现安装/卸载。
- [ ] `readOnly` / `unknown` / `incompatible` 时创建按钮禁用。
- [ ] `npm test`、`npm run check:package` 全部通过。
- [ ] 真机 Agent 与 Bot 两个模式截图验收通过。
