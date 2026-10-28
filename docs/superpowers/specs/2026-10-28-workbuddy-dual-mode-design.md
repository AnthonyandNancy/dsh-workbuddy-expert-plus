# WorkBuddy 专家市场双模式插件技术设计

**状态：** 已由用户提供的 928 行 V2.0 实施书确认需求；本文件固定实现边界与取舍。
**基线源码：** `pbwheel/dsh-workbuddy-expert@dd31d79a818125e045f349e0b0cf0b35408f9c9c`（MIT）。
**构建输入：** `infometa/workbuddyskills@7ea565af29f6bede2acc0d7b55daa300db5de3f8`。
**DS-Bot 协议基线：** `Fei2411/DS-Bot@4a7b55069ad300eae8be42a74f31bc170b40ead7`。
**交付位置：** `packages/dsh-workbuddy-expert-plus`。

## 1. 目标与约束

一个 npm 包同时承担三种职责：离线专家模板市场、DSH Agent 专家安装器、DS-Bot 原生 Bot 创建器。同一 `.tgz` 可用于 DSH Desktop/Web 与 DS-Bot 独立应用的 DSH profile。

硬约束：

- 运行时不访问 WorkBuddy 目录、GitHub、WorkBuddy CDN 或任意在线专家源；内置资源只从包内 `resources/experts` 读取。
- 不修改 DSH、DS-Bot 上游；不写 DS-Bot 私有数据；只调用其当前 `POST api/bot` 协议。
- Agent 动作与 Bot 动作隔离：切换界面不自动安装、创建、删除或迁移任何对象。
- 保留原 `/expert`、会话选择器、settings.section、安装/更新/卸载与旧导出识别。
- 资源发行只纳入有明确许可证据且内容完整的专家；无证据项记录为 blocked，不伪造授权。

## 2. 架构

### 2.1 构建期

`scripts/inventory-archive.mjs` 盘点固定快照；`convert-experts.mjs` 从 `expert_center.json` 与实际 `agents/*.md` 组装标准专家包；`audit-experts.mjs` 做完整性、许可、路径与敏感风险审核；`build-experts.mjs` 生成确定性 `manifest.json`、`catalog.sha256` 与报告；`check-package.mjs` 解包 `.tgz` 并复核所有 hash。

标准专家目录：

```
resources/experts/<stable-id>/
  expert.json
  role.md
  avatar.png            # 存在且可安全打包时
  skills/...            # 仅许可允许且实际存在时
```

`expert.json` 是 manifest 的完整记录。ID 由 `sourcePackage + agentSlug` 生成稳定 lowercase slug；内容 hash 覆盖 `role.md`、头像与 skills 清单。

### 2.2 运行期 Host

- `src/catalog/builtin.js`：以 `import.meta.url` 定位包内资源，读 manifest，逐条校验并惰性提供 Prompt/asset。
- `src/catalog/local.js`：包装原 WorkBuddy scanner，默认关闭。
- `src/catalog/unified.js`：按唯一键融合内置/用户/WorkBuddy，不静默覆盖。
- `src/catalog/resolver.js`：白名单、realpath、文件大小与稳定路径校验。
- `src/importer/*`：保留扫描器、registry、export、routes，并适配 bundled source。
- `src/adapters/environment.js`：探测 DS-Bot state 与只读/未知/不兼容状态。
- `src/adapters/dsbot-api.js`：唯一实现 `api/bot` 请求、超时、Abort、schema 校验与错误归一。
- `src/adapters/bot-template.js`：专家到 create-bot 字段映射、长度与重名约束。
- `src/services/install-expert.js`：以 Adapter 导出完整专家；保留 ownership manifest 和防覆盖。
- `src/server/bot-routes.js`：同源、单飞、限流请求体、只读校验、create 后核对 bots 列表。
- `src/index.js`：保留原 services/命令/选择器；增量挂载内置市场、状态路由和 Bot 路由。

### 2.3 Client

保留 `window.__ModuleLoader__` CJS bundle。`client/client.js` 拆成可测试的小段（仍在同一 bundle 文件内，零构建）：

- 市场页复用现有卡片、搜索、分类、Prompt 预览；新增来源徽标和状态。
- Agent 模式按钮：安装/更新/卸载。
- Bot 模式按钮：创建 Bot/已创建/再次创建；确认弹窗显示完整可编辑 Prompt、名称、角色、模型。
- DS-Bot 模式通过 `sidebar.footer.action` 注册唯一“专家市场”入口，通过 `shell.overlay` 打开自有弹层；保留 settings.section 备用入口。
- 环境未知或只读时显示禁用原因，不静默降级为安装。
- 所有注册返回 disposer；模式变化、卸载时释放 slot、请求与样式。

## 3. 数据流

1. 启动时读取内置 manifest 摘要，市场无需 WorkBuddy 即可渲染。
2. `GET api/state` 返回内置/可选本地来源、DSH 安装 overlay、Bot 映射摘要和环境快照；不在页面启动阶段调用 DS-Bot `state`。
3. 详情和创建时按需读取 role.md；服务端再次校验 hash。
4. Agent 安装：服务从 BundledSourceAdapter 读取并导出 `expert.yml + role.md + skills + avatar + .expert-source.json`，写完复核 hash。
5. Bot 创建：客户端只在 Bot 入口触发环境探测；服务端校验 operation、readOnly、重名、Prompt hash 后，单次调用 create-bot；随后 state 确认 bot ID 出现在列表。
6. 映射按 `sourceExpertId -> [botId]` 存在插件自有 profile 文件中；Bot 被删除后列表核对会清理失效映射，但不删除 Bot 或专家。

## 4. 状态机

- DS-Bot absent：Agent 安装可用；Bot 入口隐藏或说明不可用。
- ready + Bot surface：createBot。
- ready + Agent surface：install。
- readOnly + Bot：disabled + 明确原因。
- unknown/timeout/schema incompatible：disabled；不得当作 absent，也不得自动安装。
- 多窗口或多入口冲突：服务端以 operation + 当前 capability 再验证；不一致则 409，要求用户刷新确认。

## 5. 安全

- 路由只接受同源 POST；Host 必须为 loopback；请求体上限 64 KiB。
- 资源读取只允许 manifest 登记路径，realpath 必须位于资源根内，文件大小设上限。
- 不执行 skills 脚本，不自动启用 MCP/连接器。
- 不在日志、错误、状态响应中返回完整 Prompt 以外敏感信息；Prompt 仅在用户主动预览时返回。
- Bot 名称/角色长度、非法字符、重名和 Avatar 大小在客户端预检，服务端强制复验。
- 未知/超时先查询 Bot 列表核对，避免重试造成重复创建。

## 6. 资源许可策略

许可证据优先级：专家目录内 LICENSE 文件 / `license/` 目录中的明确文本 / `plugin.json.license`。仅有仓库 README 的“公开市场”描述不构成再分发授权。`license.status` 只能为：

- `approved`：存在可追溯的明确许可文本；
- `restricted`：无明显授权证据或声明限制；
- `invalid`：内容/路径/编码校验失败。

发行 manifest 只含 `approved + ready`；审计报告保留所有 429 条索引、实际 Agent 文件和 blocked 原因。若最终授权筛选使全量目标无法完成，报告必须标记“全量离线内置被授权阻塞”。

## 7. 测试与验收

自动化：

- `test/catalog-offline.test.js`：manifest、完整 Prompt、hash、路径穿越、运行时不触网。
- `test/installation.test.js`：安装/更新/卸载、防覆盖、完整 Prompt 与 skills。
- `test/mode-compat.test.js`：absent/ready/readOnly/unknown/incompatible、残留 localStorage、双窗口保守策略。
- `test/dsbot-creation.test.js`：成功、重名、只读、超时、schema 变化、双击单飞、列表确认、删除后恢复。
- `test/plugin-lifecycle.test.js`：slot 释放、请求取消、反复启用无重复。
- `test/pack-offline.test.js`：npm pack 内容、解包后 hash、删除 WorkBuddy 目录与断网模拟。
- 原有四个 smoke 继续通过。

无法在当前环境完成的实机宿主证据（E01–E16 中依赖真实 DS-Bot App/Desktop 的项）必须在 `docs/verification-report.md` 标为“未验证”，不得用单测替代。静态/集成可覆盖的 API、打包、离线资源与模式状态机必须全部执行。

## 8. 明确不做

- 不 fork 或修改 DSH/DS-Bot。
- 不引入在线下载、CDN 回源或 postinstall 拉取。
- 不自动映射 Skills/MCP 到 Bot。
- 不把未授权专家打包后宣称为已获授权全量。
- 不实现 DS-Bot 原生设置页注入或 DOM mutation。
