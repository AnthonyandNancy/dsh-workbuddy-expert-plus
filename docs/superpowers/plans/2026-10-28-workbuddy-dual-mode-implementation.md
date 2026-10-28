# WorkBuddy Dual-Mode Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `dsh-workbuddy-expert` 改造为单一离线内置专家市场包，同时支持 DSH Agent 安装和 DS-Bot 原生 Bot 创建。

**Architecture:** 构建期把固定 `workbuddyskills` 快照标准化为带许可证据的 `resources/experts`；运行期以 BundledSourceAdapter 作为主数据源，保留原 registry/switch/export，并新增 DS-Bot 环境适配器、create-bot 路由和 Bot slot UI。测试优先覆盖资源、状态机、API 与打包离线边界。

**Tech Stack:** Node.js >=20 ESM、内置 `node:test`、DSH Cordis/WebServer/Settings、原生 `window.__ModuleLoader__` 客户端 bundle、DS-Bot `POST api/bot`。

## Global Constraints

- 基线插件：`pbwheel/dsh-workbuddy-expert@dd31d79a818125e045f349e0b0cf0b35408f9c9c`。
- 资源快照：`infometa/workbuddyskills@7ea565af29f6bede2acc0d7b55daa300db5de3f8`。
- DS-Bot 协议：`Fei2411/DS-Bot@4a7b55069ad300eae8be42a74f31bc170b40ead7`；Bot name ≤40、role ≤24、avatar ≤160000 bytes。
- 运行时不访问 WorkBuddy/GitHub/CDN；`resources/experts` 是唯一必需来源。
- 不修改 DSH/DS-Bot 源码；不写 DS-Bot 私有存储；不 DOM 注入。
- 仅打包 `ready + license.approved`；无许可证据项必须报告 blocked。
- Agent 与 Bot 状态字段完全分离；readOnly/unknown/incompatible 禁止创建。
- 保留 `/expert`、会话选择器、settings.section、安装/更新/卸载和旧 manifest 识别。
- 所有新增行为先写失败测试，再写最小实现。

---

### Task 1: 测试基础设施与包身份

**Files:**
- Modify: `scripts/smoke.mjs`, `scripts/smoke-client.mjs`, `scripts/smoke-importer.mjs`, `scripts/smoke-install.mjs`
- Modify: `package.json`, `cordis.patch.yml`, `client/client.js`, `src/index.js`, `src/importer/settings.js`
- Create: `test/helpers.mjs`, `test/package-contract.test.js`

**Interfaces:**
- Produces: 包名 `dsh-workbuddy-expert-plus`；统一插件 ID/namespace；跨平台 `fileURLToPath` 测试根路径；`npm test` 运行所有 Node 测试与 smoke。

- [ ] **Step 1: 写失败测试**

```js
// test/package-contract.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('package identity is the independent dual-mode plugin', () => {
  assert.equal(pkg.name, 'dsh-workbuddy-expert-plus')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.files.includes('resources/experts'))
})
```

- [ ] **Step 2: 验证 RED**

Run: `node --test test/package-contract.test.js`
Expected: FAIL，实际 name 仍为 `dsh-workbuddy-expert`。

- [ ] **Step 3: 最小实现**

修改四个 smoke 脚本：`import { fileURLToPath } from 'node:url'`，`const root = fileURLToPath(new URL('..', import.meta.url))`。把包名、cordis id、client `load({ id })`、`SETTINGS_NS`、路由基址统一为 `dsh-workbuddy-expert-plus`。`package.json` 增加 `"test": "node --test test/*.test.js && node scripts/smoke.mjs && node scripts/smoke-client.mjs && node scripts/smoke-importer.mjs && node scripts/smoke-install.mjs"` 与 `files: ["src","client","resources/experts","cordis.patch.yml","locale/*.json","icon.svg","LICENSE","README.md"]`，保留 DSH peer 范围。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/package-contract.test.js && node scripts/smoke.mjs && node scripts/smoke-client.mjs && node scripts/smoke-importer.mjs && node scripts/smoke-install.mjs`
Expected: 全部 PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-workbuddy-expert-plus
git commit -m "feat: establish independent dual-mode package identity"
```

---

### Task 2: 资源盘点、许可审核与标准化转换

**Files:**
- Create: `scripts/inventory-archive.mjs`, `scripts/audit-experts.mjs`, `scripts/convert-experts.mjs`, `scripts/build-experts.mjs`
- Create: `test/expert-build.test.js`
- Create: `vendor-input/README.md`
- Modify: `package.json` scripts

**Interfaces:**
- Produces: `build/reports/inventory.json`、`conversion.json`、`license-audit.json`、`security-audit.json`；`resources/experts/manifest.json` 项结构 `{id,source,sourcePackage,sourceAgent,sourceRevision,displayName,profession,categoryId,description,roleFile,avatarFile?,skills,requiredCapabilities,license,compatibility,contentSha256}`。

- [ ] **Step 1: 写失败测试**

```js
// test/expert-build.test.js
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../resources/experts/manifest.json', import.meta.url), 'utf8'))

test('manifest contains only complete approved experts', async () => {
  assert.ok(manifest.experts.length > 0)
  for (const expert of manifest.experts) {
    assert.equal(expert.license.status, 'approved')
    assert.equal(expert.ready, true)
    const role = await readFile(new URL(`../resources/experts/${expert.roleFile}`, import.meta.url), 'utf8')
    assert.ok(role.trim().length > 200)
  }
})
```

- [ ] **Step 2: 验证 RED**

Run: `node --test test/expert-build.test.js`
Expected: FAIL，`manifest.json` 不存在。

- [ ] **Step 3: 最小实现**

实现确定性盘点：递归扫描 429 个目录、729 个顶层 agents、所有 skills；按 `expert_center.json` 路径做 `realpath` 与根内校验；缺文件记为 `missing_file`，未索引 agent 记为 `unindexed_agent`。许可只认可目录 `LICENSE`、`license/*` 或 `plugin.json.license`；其余 `restricted`。转换仅输出 `ready + approved` 专家，完整复制 agent 正文（保留 frontmatter 外正文），安全复制头像与许可技能文件，拒绝 symlink/路径穿越。生成 `catalog.sha256` 与四份报告。

- [ ] **Step 4: 验证 GREEN**

Run: `npm run build:experts && node --test test/expert-build.test.js`
Expected: PASS；报告中 blocked 数与全部索引/agent 文件数一致可追溯。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-workbuddy-expert-plus vendor-input/README.md
git commit -m "feat: build audited offline expert catalog"
```

---

### Task 3: 运行时内置目录与统一来源

**Files:**
- Create: `src/catalog/schema.js`, `src/catalog/resolver.js`, `src/catalog/builtin.js`, `src/catalog/local.js`, `src/catalog/unified.js`, `src/adapters/source.js`
- Create: `test/catalog-offline.test.js`
- Modify: `src/importer/index.js`, `src/importer/routes.js`, `src/importer/scanner.js`

**Interfaces:**
- Produces: `createBundledCatalog({root, pluginVersion}) -> {stateOf(), readPrompt(id), readAsset(id, rel), fingerprint(id), sourceRecord(id)}`；统一卡片字段 `sourceKind`, `sourceKey`, `agentInstalled`, `botCreated`；`createUnifiedCatalog({builtin, local})`。

- [ ] **Step 1: 写失败测试**

```js
test('bundled catalog renders without WorkBuddy and rejects traversal', async () => {
  const catalog = createBundledCatalog({ root: fixtureRoot, pluginVersion: '0.1.0' })
  const state = await catalog.stateOf()
  assert.ok(state.experts.length > 0)
  assert.ok((await catalog.readPrompt(state.experts[0].id)).length > 200)
  await assert.rejects(() => catalog.readAsset(state.experts[0].id, '../secret.txt'), /outside|invalid/i)
})
```

- [ ] **Step 2: 验证 RED**

Run: `node --test test/catalog-offline.test.js`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 最小实现**

以 `import.meta.url` 解析 `resources/experts`。启动只读 manifest，不深扫目录；校验 hash 与大小；详情按需读 Prompt；asset resolver 做 manifest 白名单 + realpath 根内校验。把内置源作为主表，本地 WorkBuddy 只在 `enableLocalWorkbuddyScan=true` 时作为附加来源；路由 state 返回来源统计、DSH overlay、环境快照，不因本地源缺失清空列表。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/catalog-offline.test.js`
Expected: PASS，且测试临时移走 WorkBuddy home 后仍通过。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-workbuddy-expert-plus/src packages/dsh-workbuddy-expert-plus/test
git commit -m "feat: add bundled-first offline expert catalog"
```

---

### Task 4: Agent 安装链路适配内置源

**Files:**
- Create: `src/services/install-expert.js`, `src/services/expert-status.js`
- Modify: `src/importer/export.js`, `src/importer/index.js`, `src/importer/routes.js`
- Create: `test/installation.test.js`

**Interfaces:**
- Consumes: `BundledCatalog` Task 3。
- Produces: `createInstallService({catalog, expertsRoot, pluginVersion})` 方法 `install(id)`, `update(id)`, `uninstall(id)`, `overlay()`；`.expert-source.json` 新字段 `source`, `sourcePackage`, `sourceAgent`, `contentSha256`, `pluginVersion`, `importedAt`，兼容旧 `sourcePath/pluginDir/agentFile/fingerprint`。

- [ ] **Step 1: 写失败测试**

```js
test('install exports complete bundled prompt and ownership evidence', async () => {
  const service = createInstallService({ catalog, expertsRoot, pluginVersion: '0.1.0' })
  const result = await service.install(catalog.firstId)
  const role = await readFile(join(result.dir, 'role.md'), 'utf8')
  const manifest = JSON.parse(await readFile(join(result.dir, '.expert-source.json'), 'utf8'))
  assert.equal(role.trim(), (await catalog.readPrompt(catalog.firstId)).trim())
  assert.equal(manifest.source, 'bundled')
  assert.equal(manifest.contentSha256, catalog.firstHash)
})
```

- [ ] **Step 2: 验证 RED**

Run: `node --test test/installation.test.js`
Expected: FAIL，service 不存在。

- [ ] **Step 3: 最小实现**

安装从 Adapter 读取真实 Prompt、skills 与头像，写 `expert.yml + role.md + skills + avatar + .expert-source.json`；写后重算 hash。更新仅在内容 hash 不同且目标有本插件 ownership 时进行；无 manifest 的目录拒绝覆盖；卸载只删本插件拥有目录；旧 WorkBuddy manifest 识别为可迁移，不静默删除。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/installation.test.js && node scripts/smoke-install.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-workbuddy-expert-plus
git commit -m "feat: install bundled experts with ownership safety"
```

---

### Task 5: DS-Bot 环境/模式适配器

**Files:**
- Create: `src/adapters/dsbot-api.js`, `src/adapters/environment.js`, `src/adapters/mode.js`, `src/adapters/bot-template.js`
- Create: `test/mode-compat.test.js`
- Modify: `src/index.js`

**Interfaces:**
- Produces: `probeDsBot({fetch, timeoutMs}) -> {status:'absent'|'ready'|'readOnly'|'unknown'|'incompatible', state?, reason?}`；`resolveOperation(snapshot, entry, surfaceHint) -> {operation:'install'|'createBot'|'disabled', reason?}`；`toBotTemplate(expert, state) -> {name,role,instructions,avatar?,model?}`。

- [ ] **Step 1: 写失败测试**

```js
test('residual bot localStorage does not create a Bot when DS-Bot is absent', () => {
  const result = resolveOperation({ dsBot: 'absent', surface: 'bot' }, { entry: 'harnessSettings' }, 'bot')
  assert.equal(result.operation, 'install')
})
test('read-only Bot mode never falls back to install', () => {
  const result = resolveOperation({ dsBot: 'readOnly', surface: 'bot' }, { entry: 'botSidebar' })
  assert.equal(result.operation, 'disabled')
})
```

- [ ] **Step 2: 验证 RED**

Run: `node --test test/mode-compat.test.js`
Expected: FAIL，模块不存在。

- [ ] **Step 3: 最小实现**

API 探测区分 404、合法 state、401/403、5xx、超时、非法 JSON 与 readOnly；不把网络错误当 absent。状态机实现保守优先级；surface hint 仅作线索，入口意图与能力共同决定；多窗口不确定时 disabled。字段映射强制 trim、长度和非法字符校验；Prompt 不做摘要。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/mode-compat.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-workbuddy-expert-plus
git commit -m "feat: add conservative DS-Bot environment detection"
```

---

### Task 6: Bot 创建服务与路由

**Files:**
- Create: `src/services/create-bot.js`, `src/server/bot-routes.js`
- Modify: `src/index.js`, `src/importer/routes.js`
- Create: `test/dsbot-creation.test.js`

**Interfaces:**
- Consumes: Task 3 catalog、Task 5 adapters。
- Produces: `POST /dsh-workbuddy-expert-plus/api/bot/create` body `{expertId,name,role,instructions,model?,avatar?}` -> `{botId,bot,alreadyExists?,state}`；`GET .../api/bot/bindings`；服务端复验 Prompt hash、readOnly、重名、单飞锁。

- [ ] **Step 1: 写失败测试**

```js
test('create calls create-bot once and verifies the bot in state', async () => {
  const service = createBotService({ catalog, api, stateStore })
  const result = await service.create({ expertId: catalog.firstId, name: '产品研发专家', role: '产品研发顾问' })
  assert.equal(api.calls.filter((call) => call.endpoint === 'create-bot').length, 1)
  assert.equal(result.verified, true)
})
```

- [ ] **Step 2: 验证 RED**

Run: `node --test test/dsbot-creation.test.js`
Expected: FAIL，service 不存在。

- [ ] **Step 3: 最小实现**

服务先读 Prompt 并校验 manifest hash；探测 state，拒绝 readOnly/incompatible；重名预检；单飞；唯一一次 create-bot；用返回 bot id 和 `state.bots` 复核；写入插件自有映射（原子 temp+rename）；超时先查 bots 再允许重试。路由同源、64 KiB 上限、逐项错误码映射。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/dsbot-creation.test.js`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-workbuddy-expert-plus
git commit -m "feat: create native DS-Bot bots from bundled experts"
```

---

### Task 7: 客户端双模式市场 UI

**Files:**
- Modify: `client/client.js`
- Create: `test/client-dual-mode.test.js`, `test/plugin-lifecycle.test.js`

**Interfaces:**
- Consumes: Task 6 routes。
- Produces: settings.section 备用市场；`sidebar.footer.action` 唯一入口；`shell.overlay` 弹层；Agent/Bot 两种 ActionRenderer；环境原因显示。

- [ ] **Step 1: 写失败测试**

```js
test('client registers bot slots and a single market entry', () => {
  assert.match(source, /sidebar\.footer\.action/)
  assert.match(source, /shell\.overlay/)
  assert.match(source, /id: 'workbuddy-expert-plus-market'/)
})
```

- [ ] **Step 2: 验证 RED**

Run: `node --test test/client-dual-mode.test.js`
Expected: FAIL，slot 与 create UI 缺失。

- [ ] **Step 3: 最小实现**

复用原市场卡片、搜索、详情；增加操作意图。Bot 模式显示创建表单：名称、角色、模型、完整可编辑 Prompt；只读、unknown、不兼容时禁用并解释。创建成功显示 bot id 并刷新状态；双击禁用。slot 全部登记 disposer；Esc、焦点、遮罩、滚动锁、主题、窄宽度。

- [ ] **Step 4: 验证 GREEN**

Run: `node --test test/client-dual-mode.test.js && node scripts/smoke-client.mjs && node scripts/smoke-importer.mjs`
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-workbuddy-expert-plus
git commit -m "feat: add dual-mode market UI and DS-Bot entry"
```

---

### Task 8: 生命周期、打包与端到端离线验证

**Files:**
- Create: `scripts/check-package.mjs`, `test/plugin-lifecycle.test.js`, `test/pack-offline.test.js`
- Create: `docs/compatibility-matrix.md`, `docs/resource-audit.md`, `docs/build-and-release.md`, `docs/verification-report.md`, `README.md`
- Modify: `package.json`, `src/index.js`

**Interfaces:**
- Produces: `npm test`、`npm run build:experts`、`npm run check:package`、`.tgz`、完整报告。

- [ ] **Step 1: 写失败测试**

```js
test('generated tgz contains manifest and every approved role prompt', async () => {
  const listing = JSON.parse(await readFile(join(buildDir, 'packaged-contents.json'), 'utf8'))
  assert.ok(listing.files.includes('resources/experts/manifest.json'))
  for (const expert of manifest.experts) {
    assert.ok(listing.files.some((file) => file.endsWith(expert.roleFile)))
  }
})
```

- [ ] **Step 2: 验证 RED**

Run: `npm run check:package`
Expected: FAIL，脚本不存在。

- [ ] **Step 3: 最小实现**

`check-package.mjs` 执行 `npm pack --json`，在临时空目录解包，逐 hash 校验 manifest、role、avatar、skills，删除 `vendor-input` 影响路径后运行 catalog 读取；确认无网络或 WorkBuddy 路径回退。验证反复 mount/unmount 后无重复注册。生成兼容矩阵、资源审计、构建发布和验证报告；报告中区分自动化通过、实机未验证和授权阻塞。

- [ ] **Step 4: 验证 GREEN**

Run: `npm run build:experts && npm test && npm run check:package`
Expected: 全部 PASS；报告明确剩余实机与授权状态。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-workbuddy-expert-plus docs
git commit -m "test: verify packaged offline dual-mode delivery"
```

---

### Task 9: 全量代码审查与修复

**Files:**
- Review: whole branch diff
- Modify: 仅修复审查发现

- [ ] **Step 1: 生成审查包**

```bash
mkdir -p .superpowers/sdd
git diff 747781c..HEAD > .superpowers/sdd/final-review.diff
git log --oneline 747781c..HEAD > .superpowers/sdd/final-review-log.txt
```

- [ ] **Step 2: 代码审查**

检查规格覆盖、安全边界、状态串线、资源许可真实性、异常路径、测试是否真正失败过、是否有占位实现。

- [ ] **Step 3: 修复所有 Critical/Important**

每项先补失败测试，再修；重新运行覆盖测试。

- [ ] **Step 4: 最终验证**

Run: `npm test && npm run check:package`
Expected: 0 失败。

- [ ] **Step 5: 提交**

```bash
git add packages/dsh-workbuddy-expert-plus docs
git commit -m "fix: address final dual-mode review findings"
```
