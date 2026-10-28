# WorkBuddy 专家市场双宿主兼容与离线内置改造技术方案 V2.0

> **文档性质**：面向 AI Agent / Codex 的可实施技术设计与验收规格（Markdown）  
> **修订日期**：2026-10-28  
> **方案基础**：复制 `pbwheel/dsh-workbuddy-expert` 的实际源码，改造为一个独立、可离线安装的 DSH 插件。  
> **资源来源**：`infometa/workbuddyskills`，作为**构建时的离线资源输入**，不是用户运行时的依赖。  
> **双宿主**：① 原生 DeepSeek Harness（DSH Desktop / Web）；② DS-Bot 插件模式及其自带 DSH 的独立桌面应用。  
> **零侵入约束**：不修改 DSH 或 DS-Bot 上游代码；不通过 DOM 注入、篡改宿主内部状态或写入 DS-Bot 私有存储来模拟功能。  
> **状态**：源码研究后的实施规格，不代表功能已经安装验证；对独立桌面端和 UI 插槽的实际显示仍设冒烟验收门槛。

---

## 0. 本次 V2.0 与原方案的本质区别（必须先读）

上版方案虽然提到“离线资源”和“宿主”，但没有将它们落实成**决定架构与验收的硬约束**。本版明确修正：

| 原方案易产生的误解/缺口 | V2.0 强制规定 |
|---|---|
| 安装后从 `~/.workbuddy/...` 扫描专家 | **运行时默认仅从随插件包发布的 `resources/experts` 读取完整资源；没有 WorkBuddy 目录仍必须正常显示并安装专家。** |
| 仅内置专家索引/名字 | **内置专家需包含真实可用的完整 Prompt、元数据和可授权打包的必要附件**，不可用空 Prompt、简介、在线 URL、运行时下载替代。 |
| `workbuddyskills` 是“以后可以导入”的候选 | **构建流水线必须对其进行全量盘点、解析、验证、转换、筛选、生成确定性 manifest、打包检测。** |
| Bot 模式能用即算“兼容” | **同一个安装包必须覆盖 DSH 本体、DSH+DS-Bot Agent、DSH+DS-Bot Bot、DS-Bot 独立桌面端；每个环境均有独立验收。** |
| 只根据 `localStorage` 决定 Agent/Bot | **必须同时检查 DS-Bot 服务能力与当前界面模式**，处理遗留 key、未安装、版本不兼容和多窗口。 |
| DS-Bot 侧边栏“应该能显示” | **侧边栏与弹层按已知 UI 插槽接入，但独立桌面应用的实际显示、CSS 层级与插件加载必须实测通过。** |
| Bot 创建只要返回成功 | **要确认真正创建的 Bot 被 DS-Bot 保存、列表可见、提示词一致、重复操作可控、只读/异常能正确失败。** |

### 0.1 项目不可妥协的五条验收红线

- **R1 真离线**：目标机器全程无 WorkBuddy、无 `~/.workbuddy`、无网络连接，安装 `.tgz` 后**内置专家列表非空**，可以预览完整 Prompt；Agent 模式可以正常安装至少一个授权可发布专家。不能用事先放入用户 home 的资源冒充内置。
- **R2 真双宿主**：同一个插件发行包，不做 `-agent` / `-bot` 两份 fork；普通 DSH 可独立运行，启用 DS-Bot 后自动获得 Bot 模式行为，独立 DS-Bot 应用通过其**自身 DSH 配置**安装同一个包。
- **R3 动作不串线**：Agent 模式为“安装/更新/卸载”，Bot 模式为“创建 Bot/已创建/再次创建”；切换模式不自动创建、不删除、不迁移、不更改旧实例。
- **R4 保留原能力**：原插件的 `/expert`、会话专家切换、导出专家目录、已有用户专家文件夹识别不得回归；新增 Bot 能力是可选依赖。
- **R5 资源合规**：资源必须真实可用且有明确分发依据。**公开 GitHub 可见不等于授权再发布**；如果全库未获得分发授权，只能发布获准资源的离线包，不能宣称已在发行包中内置全部 429 个专家。

---

## 1. 目标产品行为：一个插件、同一市场、两套动作

### 1.1 场景矩阵

| 运行环境 | 插件是否应独立启动 | 专家来源 | 主要入口 | 专家卡片动作 | 持久化目标 |
|---|---|---|---|---|---|
| **A. DSH 本体（无 DS-Bot）** | 是，绝不能强依赖 DS-Bot | **打包内置优先**；用户自定义可选；WorkBuddy 扫描可选 | `DSH 设置 → 专家市场` | **安装 / 更新 / 卸载** | 当前 DSH profile 的用户专家目录 |
| **B. DSH + DS-Bot，处于 Agent 界面** | 是 | 同上 | 原生 DSH 设置/原会话选择器 | **安装 / 更新 / 卸载** | 同上 |
| **C. DSH + DS-Bot，处于 Bot 界面** | 是 | 同上 | DS-Bot 侧边栏底部“专家市场”，弹出市场；Harness 设置为备用入口 | **创建 Bot** | DS-Bot 的 Bot 实例及其 `instructions` |
| **D. DS-Bot 独立桌面应用，处于 Bot 界面** | 在确认其内嵌 DSH 插件管理可安装并启用后应可运行 | 必须从**本应用安装的插件包**读取，不要求外部 DSH 或 WorkBuddy | 侧边栏“专家市场” | **创建 Bot** | 独立应用自己的 DS-Bot 数据目录 |
| **E. DS-Bot 独立桌面应用切到 Agent 界面** | 同 D | 同上 | 原生 DSH 设置与专家选择器 | **安装 / 更新 / 卸载** | 独立应用当前 DSH profile 的专家目录 |
| **F. DS-Bot 插件未启用/接口不可达** | 是 | 内置专家仍正常展示 | DSH 原生设置 | 保持 **Agent 安装**；不出现可执行的 Bot 创建 | DSH 专家目录 |

注意：**DSH Desktop 内安装一次插件，不代表 DS-Bot 独立桌面应用内也已安装**。独立应用自带自己的 DSH 与数据位置，需要分别安装并验证。

### 1.2 人机交互不变式

1. 安装插件即拥有**离线可浏览的内置专家模板库**；浏览不等于安装到 Agent，更不等于生成 Bot。
2. Agent 模式显示原来的“安装”语义；安装成功后 `/expert` 与会话选择器能够找到这个专家。
3. Bot 模式显示“创建 Bot”；点击后可预览/编辑名称、角色、完整 Prompt、模型，用户确认才调用 Bot 接口。
4. Bot 创建成功后返回 Bot ID，刷新 Bot 列表；原模板仍留在内置库中，二者版本和生命周期独立。
5. 一位专家允许被用户**主动**创建多个 Bot（不同名称）；默认阻止无意识重复创建。
6. 无 WorkBuddy 时不显示“请先打开 WorkBuddy 下载专家”，也不能因本地源目录不存在使整个市场变空。
7. 无 DS-Bot 时不弹出“找不到 Bot API”阻断普通 DSH；只有用户主动选择 Bot 创建且环境支持时才使用它。

### 1.3 流程

```text
               安装单个新插件（含 resources/experts/...）
                                    |
                      离线读取内置 manifest（主数据源）
                                    |
                    专家列表 / 搜索 / 分类 / Prompt 预览
                                    |
                       当前运行环境能力与模式检测
                  +-----------------+-----------------+
                  |                                   |
         DSH / Agent 模式                      DS-Bot / Bot 模式
                  |                                   |
             [安装专家]                          [创建 Bot]
                  |                                   |
       将完整专家资源导出到                     预览并编辑创建字段
        当前 profile 的 experts                 用户确认后调用 create-bot
                  |                                   |
        /expert、会话选择器可用                Bot 列表出现实例及完整指令
```

---

## 2. 源码研究与可信事实（2026-10-28 公共代码）

本节不是“猜测实现”，而是开发时必须逐项复核的源码入口。研究的是公开 `main` 分支的文件内容，**当前没有在本会话中获得可固定的三仓 commit SHA，也未做实际宿主联调**。开发启动时先锁定 SHA，并记录在 `docs/upstream-lock.json`。

| 仓库 / 文件 | 已可核对的事实 | 实施结论 |
|---|---|---|
| [`dsh-workbuddy-expert/package.json`](https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/package.json) | 插件 `0.2.2`；`main=src/index.js`、`./client=client/client.js`；DSH `>=0.2.0-rc.2 <0.3.0`；`files` **当前未包含 `resources/`**；Web 客户端注入 `dsh-client-ui-settings` 等 | **必须修改打包白名单**，否则开发机能看到内置文件，发 `.tgz` 后却消失。DSH 兼容范围不能凭空扩大。 |
| [`src/index.js`](https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/src/index.js) | 创建专家 registry、`/expert` 命令、切换器、可选 importer；`sourcePath` 默认来自 WorkBuddy 路径 | **主启动流程需新增 bundled source**，但保留 registry/switch 的现有生命周期。 |
| [`src/importer/scanner.js`](https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/src/importer/scanner.js) | `DEFAULT_SOURCE_PATH = '~/.workbuddy/plugins/marketplaces/experts/plugins'`；将插件中的 `agents/*.md` 解析为卡片 | 不能仅把默认 `sourcePath` 改成本地打包目录了事，须分离“只读内置源”和“可选本地源”。 |
| [`src/importer/catalog.js`](https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/src/importer/catalog.js) | 扫描缓存按 sourcePath 与清单指纹处理 | 新版应对固定内置 manifest 走版本/hash 缓存，对可变本地源保留扫描缓存。 |
| [`src/importer/export.js`](https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/src/importer/export.js) | 把扫描卡片导出为 `expert.yml`、`role.md`、`skills/`、`.expert-source.json`，阻止覆盖不属于本插件的目录 | **适配不同来源的资源解析与文件复制**，保证原导出与所有权规则不回归。 |
| [`src/importer/routes.js`](https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/src/importer/routes.js) | `api/state`、`api/avatar`、`api/install`、`api/update`、`api/uninstall` 等路由 | 仍使用原命名空间，但增加 `source=bundled` 和来源可用性状态。 |
| [`client/client.js`](https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/client/client.js) | 是 `window.__ModuleLoader__.load(...)` 的宿主 bundle；已有 `settings.section`、`conversation.input.left` 的插槽注册 | 保持现有客户端打包方式，不能简单改成普通 Vite/React 页面；可新增插件自有的 sidebar 和 overlay UI。 |
| [`workbuddyskills/README.md`](https://github.com/infometa/workbuddyskills/blob/main/README.md) | `experts/`、`skills/`、`connectors/`、`plugins/` 与 `CATALOG.md`；作者称**429 个专家插件目录**，并提示未经授权不得商业再分发 | 以真实目录盘点为准；429 是归档目录数，不等于 429 个已验收可运行专家，更不是已获发行授权数。 |
| [`workbuddyskills/experts/expert_center.json`](https://github.com/infometa/workbuddyskills/blob/main/experts/expert_center.json) | 含分类、专家 ID、`promptFile`、`plugin`、`avatar`、标签、快捷提问等元数据 | **先按该索引解析，再验证文件实际存在并抽取完整 Agent Prompt**；不能把介绍当 Prompt。 |
| [`DS-Bot/ds-bot/package.json`](https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/package.json) | 当前公开插件包版本字段为 `0.2.3`；基于 DSH 客户端（web） | 不可沿用上版默认的“最新 0.2.2”结论。 |
| [`DS-Bot/app/package.json`](https://github.com/Fei2411/DS-Bot/blob/main/app/package.json) | 独立桌面应用版本字段为 `0.2.2`，其内嵌 `@deepseek-ai/dsh` 版本有明确锁定值 | **插件模式与独立 App 要分开测**；不默认两者具有完全一样的依赖树。 |
| [`DS-Bot/src/client/storage.js`](https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/client/storage.js)、[`surface.js`](https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/client/surface.js) | `ds-bot:surface` 的取值为 `agent` / `bot`；其 `readMode()` 在 key 缺失时默认 **`bot`** | **不允许只凭 localStorage 单一键值判定安装了 DS-Bot**。 |
| [`DS-Bot/src/client/index.js`](https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/client/index.js) | Bot 模式已使用 `sidebar.footer.action`（账户栏）和 `shell.overlay`（弹窗）；切模式时撤销 Bot 自己的 shell 插槽注册 | **可尝试在同类公开插槽注册 WorkBuddy 的“专家市场”入口**，但要在真实宿主验证它能与 Bot 自有入口并存。 |
| [`DS-Bot/src/client/api.js`](https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/client/api.js)、[`src/host/channel.js`](https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/host/channel.js) | 浏览器通过**相对路径** `api/bot` POST `{endpoint,payload}`，`create-bot` 可传 `name,role,instructions,avatar,model,effort,...`；`state` 可读 | 可调用 DS-Bot 当前已有接口，但它是当前版本的内部客户端协议，不是独立 SDK，必须隔离在适配器。 |
| [`DS-Bot/src/host/roster.js`](https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/host/roster.js) | Bot 名称最多 40 字符；角色最多 24 字符；Prompt 由 `instructions` 保存；重名拒绝；头像可接受经校验的 data URL，有长度上限 | 所有字段都必须做长度、类型、重名、头像降级处理。 |

### 2.1 调研必须承认的边界

- `sidebar.footer.action`、`shell.overlay` **能注册不等于已经在独立桌面应用证明可见**；其渲染与优先级必须进行冒烟测试。
- `ds-bot:surface` 是 DS-Bot **当前实现细节**，不是第三方插件稳定 API。不能对未来版本作绝对保证。
- `api/bot` 不是文档化的长期稳定开放 API。兼容只能通过版本矩阵 + 能力探测 + 回归测试承担。
- `workbuddyskills` 的 `promptFile` 路径是**归档相对路径的线索**，不能不经扫描就把任意字符串拼成目标文件路径。必须检查 `realpath`、文件存在性与允许目录边界。
- 本方案是**设计规格**，不是已经重打包的专家资源插件，也不宣称目前已拿到资源再发行授权。

---

## 3. 新插件架构：必须把 WorkBuddy 从运行时依赖中拿掉

### 3.1 根本设计原则

**`workbuddyskills` 只参与“构建/整理”流程；最终安装包携带可用的 `resources/experts`。运行时不访问 WorkBuddy、不访问 GitHub、不请求 WorkBuddy CDN、不要求 WorkBuddy 的用户数据目录。**

把原版“**扫描本机 WorkBuddy → 列表 → 安装**”改成：

```text
                      【构建期：开发/发布机器】
归档 workbuddyskills（固定 SHA）
          |
   inventory → parse → normalize → validate → audit license/security
          |
   generate manifest + bundled expert files + audit report
          |
   npm pack (.tgz)  [包含实际 Prompt 和资产]
          |
-------------------------------------------------------------------
                      【运行期：用户机器，离线】
插件包内部 resources/experts/  <-- 唯一必需的数据源
          |
      BuiltinCatalog --------------+
                                    | → UnifiedExpertCatalog → UI / Exporter
用户手工专家目录（可选） ------------+
                                    |
WorkBuddy 本地目录（默认关闭，可选）-+
                                    |
                           DSH Agent Install / DS-Bot Create
```

### 3.2 必须落地的目录结构

```text
workbuddy-expert-dual/               # 从 dsh-workbuddy-expert 复制创建的独立项目
├── package.json
├── LICENSE                         # 保留原插件的 MIT 文本及归属
├── README.md
├── cordis.patch.yml
├── client/
│   ├── client.js                    # 保留 DSH 当前 bundle 加载协议
│   └── (可选模块源码或生成脚本)
├── src/
│   ├── index.js                     # 原插件 host 主入口
│   ├── registry.js                  # DSH expert registry（复用）
│   ├── switch.js                    # DSH 会话专家切换（复用）
│   ├── importer/                    # 原 scanner/catalog/export/routes（改造适配）
│   ├── catalog/
│   │   ├── builtin.js               # 从安装包读取内置 manifest
│   │   ├── local.js                 # 可选本地来源
│   │   ├── unified.js               # ID 去重、融合、来源归一
│   │   ├── resolver.js              # 安全解析 Prompt / Skills / avatar
│   │   └── schema.js                # 专家 DTO 校验
│   ├── adapters/
│   │   ├── environment.js           # DSH/DS-Bot 能力探测（host/client 分工）
│   │   ├── mode.js                  # Agent/Bot 模式（客户端）
│   │   ├── dsbot-api.js             # 仅这里引用 api/bot 协议
│   │   └── bot-template.js          # 专家字段映射到创建参数
│   └── services/
│       ├── install-expert.js        # 保留、统一 Agent 导出行为
│       └── expert-status.js         # 模板/导出/已创建 Bot 三种状态
├── resources/
│   └── experts/
│       ├── manifest.json           # 全量实际打包专家索引
│       ├── catalog.sha256
│       └── <expert-id>/
│           ├── expert.json         # 元数据 + 来源记录
│           ├── role.md             # 完整真实 Prompt（不是简介）
│           ├── avatar.png          # 授权且存在时
│           └── skills/             # 授权且需要的技能文件（可缺省）
├── scripts/
│   ├── inventory-archive.mjs       # 原始归档完整清点
│   ├── convert-experts.mjs         # 原始文件 → 标准专家包
│   ├── audit-experts.mjs           # 授权 + 安全 + 引用审查
│   ├── build-experts.mjs           # manifest、hash、稳定排序
│   └── check-package.mjs          # 对已产出的 .tgz 做解包内容检查
├── vendor-input/                   # 构建时数据输入（不进入发行包）
│   └── README.md
├── test/
│   ├── catalog-offline.test.js
│   ├── installation.test.js
│   ├── mode-compat.test.js
│   ├── dsbot-creation.test.js
│   ├── plugin-lifecycle.test.js
│   └── fixtures/
└── docs/
    ├── upstream-lock.json          # 开发执行时必须填写三仓精确 SHA
    ├── compatibility-matrix.md
    ├── resource-audit.md
    ├── build-and-release.md
    └── verification-report.md
```

目录是**目标结构**，不是假称当前仓库已有这些文件；允许合理改名，但必须实现等价职责。`vendor-input` 只能是构建输入，不得使安装包启动需要其存在。

### 3.3 内置资源优先级与冲突规则

实现统一的资源模型，但**不把第三方本地内容静默覆盖内置内容**：

- **主目录**：内置包 `bundled`，首启即加载。不存在 WorkBuddy 时依然完整。
- **用户自定义目录**：可配置并启用；与内置同名时显示“同名不同来源”或为用户版本建立独立键；不能用路径相同的假设硬覆盖。
- **WorkBuddy 本地扫描**：默认关闭。用户主动启用才扫描指定目录；源目录不存在仅显示“可选本地来源未找到”，不能使内置专家不显示。
- **唯一键**：`sourceKind + ':' + sourcePackage + ':' + agentSlug`；映射到 DSH `expert.yml` 时使用经规则生成的合法稳定 ID。不能把不同团队内的同名 `agents/*.md` 合并成一个专家。
- **冲突**：内置资源本身只读；安装到 DSH 的目标专家目录如果已有用户手写文件且无本插件归属标记，拒绝覆盖并给出重命名方案。

### 3.4 运行时路径必须相对插件自身位置

**禁止**依赖 `process.cwd()`、固定 `~/.workbuddy` 或源项目工作目录获取内置资源。Node Host 应当以当前插件模块 URL 解析其发布资源目录：

```js
// 仅示意文件定位策略；路径需按打包后模块位置校验
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const srcDir = dirname(fileURLToPath(import.meta.url))
const bundledRoot = resolve(srcDir, '..', 'resources', 'experts')
```

`sourcePath` 不再是专家市场的必要全局参数；建议配置为 `enableLocalWorkbuddyScan=false`，`localWorkbuddyPath` 仅在主动启用时才生效。**内置源不能被用户误修改 `sourcePath` 导致消失。**

---

## 4. `workbuddyskills` 全量转换：从原始目录到真正可用的内置专家

### 4.1 需要明确区分的四个数字

1. **归档目录总数**：README 声明 `experts/` 下有 429 个专家插件目录，属于来源说明。
2. **发现的 Agent 文件数**：实际遍历每个插件内 `agents/` 后统计；一个插件可能有多 Agent，也可能缺文件。
3. **转换有效专家数**：通过 Prompt、ID、文件、安全校验的对象数量。
4. **允许打包发行数**：通过**逐项分发授权**的转换有效专家数量。

`总目录数 ≠ Agent 数 ≠ 有效专家数 ≠ 已授权发行数`。发布说明只允许写明最后的真实数字。

### 4.2 实际输入盘点

针对固定 SHA 的 `infometa/workbuddyskills` 本地源码快照：

- 对 `experts/expert_center.json` 建立 `id/categoryId/plugin/agentName/promptFile/avatar` 的元数据引用表。
- 对 `experts/` 下实际文件系统做递归盘点，**动态识别**插件目录、`.codebuddy-plugin/plugin.json`、`agents/*.md`、`rules/*.md`、`skills/`、`avatars/`、插件 README 等真实结构；**不能依赖当前未验证的硬编码拼接路径**。
- 建立 `source-index.json`（按文件关联来源、路径、SHA-256、所属插件、许可状态）。
- 对元数据引用到但实际不存在的 Prompt、头像、规则，记录为 `missing_file`，不可编造。
- 对被实际扫描到但没有 `expert_center.json` 对应条目的 Agent 记录 `unindexed_agent`，不能直接丢弃。
- 检测同一个仓库中 `experts/` 与 `plugins/` 的重复/复制内容，按内容 hash 识别；不要让市场重复出现相同专家。

### 4.3 标准化输出 DTO

```json
{
  "id": "wb-content-creator-content-creator",
  "source": "bundled",
  "sourcePackage": "content-creator",
  "sourceAgent": "content-creator.md",
  "sourceRevision": "<固定的 workbuddyskills commit SHA>",
  "displayName": "内容创作专家",
  "categoryId": "06-ContentCreative",
  "description": "多平台内容策划与创作",
  "roleFile": "role.md",
  "avatarFile": "avatar.png",
  "skills": [],
  "requiredCapabilities": [],
  "license": {
    "status": "approved",
    "evidence": "<逐项许可依据或内部授权记录>"
  },
  "compatibility": {
    "agent": "export-ready",
    "bot": "prompt-only"
  },
  "contentSha256": "<实际 role.md 及依赖内容的计算结果>"
}
```

这只是**结构示例**，不表示上述实际专家已获得授权。实际文件里的 `role.md` 必须包含完整、真实解析出的角色正文。`description` / `quickPrompts` 不能替代 `role.md`。

### 4.4 Prompt 组装规则

1. 以实际 `agents/<agent>.md` 的主体文本为核心；保留有意义的角色设定、行为规则、任务边界、输出要求。
2. 在原插件扫描器允许的前提下，保留关联 `rules/*.md` 的有效内容；明确每部分来源、顺序，避免重复拼接。
3. Markdown frontmatter 可解析为字段，但**不能把 YAML 原文混同于系统指令**。
4. 对自引用命令、WorkBuddy 特有变量、文件绝对路径、模型能力假设进行标记，必要时转换为可读注释或“仅在特定环境可用”的提示；**不能擅自改写专家意图**。
5. 包内 `skills/`：只复制许可允许且实际存在的文件；不自动运行任何脚本、不自动开启外部 MCP。
6. 对 `role.md` 做空值、编码、体积、过量令牌风险检查；过大时必须可预览且提示模型上下文成本，**不得静默截断完整 Prompt**。
7. 防止路径穿越、软链接逸出、危险绝对路径、zip/tar 炸弹、恶意链接、内嵌密钥、未经授权的二进制执行。
8. 自动转换结束后产出每条专家的 `status=ready|invalid|restricted`，发行包默认只包含 `ready + license.approved` 的专家。

### 4.5 授权与发布之间的硬边界

`workbuddyskills` README 指出资源来自 WorkBuddy/CodeBuddy 公开市场，并提醒勿作未授权商业再分发。**原项目采用 MIT，不会使其引用的专家 Prompt 变成 MIT。**

因此执行上要求：

- 开发阶段可以构建“本地测试归档的解析器、清单和报告”，对内容进行个人/内部使用也要遵守适用许可；不得假定所有内容可商业分发。
- 正式分发插件时，每个内置专家必须有清晰可追溯的 `license.evidence` 或经法务/授权方确认的授权材料；不通过者不打包、不宣传为内置完成。
- 如果你的业务要求**最终发布版包含该仓库可用专家的全量**，则“取得相应授权”是发布的真实前置条件，不应由技术文档偷偷降级为“只内置几个演示专家”。
- **授权不全时的客观状态应报告为“全量离线内置目标被授权阻塞”**，而不是把运行时在线下载改名为“内置”。

### 4.6 必须生成的报告

```text
build/reports/inventory.json          # 发现多少目录、Agent、Skills、图像
build/reports/conversion.json         # 转换成功/失败，逐条原因
build/reports/license-audit.json      # 每条的授权状态及依据
build/reports/security-audit.json     # 存在的脚本/外部依赖/风险
build/reports/packaged-contents.json  # 真正进入 .tgz 的专家和文件
```

**不以 429 为验收断言**；以源快照实际扫描和报告完整性为断言。凡存在可用但无故遗漏的 Agent 必须追踪、解释、修复。

---

## 5. 发行包与绝对离线启动（不是“安装后再下载”）

### 5.1 修改 package.json 是硬要求

原插件 `package.json.files` 未包含资源目录；必须加上 `resources/experts`、必要的脚本产物和迁移支持，并确保 `./client` 及其他 `exports` 不被破坏。

```json
{
  "name": "<独立发布的新插件包名>",
  "files": [
    "src",
    "client",
    "resources/experts",
    "cordis.patch.yml",
    "locale/*.json",
    "icon.svg",
    "LICENSE",
    "README.md"
  ]
}
```

项目改名还要同步更新 Host `name`、浏览器模块 `window.__ModuleLoader__.load({id:...})`、`NS`、API namespace、`cordis.patch.yml`、所有插槽 ID；**不可只修改 npm 名字**。如果计划让新插件替代旧插件，需设计旧专家导出与新插件识别关系，避免重复启用两个名称冲突的 `experts` 服务。

### 5.2 打包验证流程

1. 固定三仓版本与 Node/DSH 依赖，使用确定的依赖锁文件。
2. 从 `workbuddyskills` 快照执行扫描、解析、校验、授权筛选，生成真实 `resources/experts/manifest.json` 和文件。
3. 运行 `npm pack --dry-run --json` 核对资源文件出现在产物列表，文件体积和 manifest 中数量一致。
4. 生成 `.tgz` 后在**空目录实际解压**，以解包目录为插件根路径打开 manifest、完整 role.md 与头像，重新验证 hash。
5. 在无 WorkBuddy、断网环境下从 `.tgz` 安装；市场必须非空，且 Agent 模式导出能成功。
6. 检查 Linux/macOS 路径大小写、Windows 路径分隔符、中文文件名及 Unicode 正规化。
7. 禁止 `postinstall` 联网拉取专家；不能把 `vendor-input/`、测试密钥、构建缓存误加入发行包。

### 5.3 无 WorkBuddy 的唯一正确体验

- 市场页不再以“本地 WorkBuddy 目录不存在”为全局空态。
- 标题可显示 `内置专家：N · 自定义：M · WorkBuddy 本地：已关闭`。
- “本地 WorkBuddy 路径”只在用户主动选择“导入更多本地专家”时出现。
- 内置专家读失败，应显示明确的包完整性错误（例如缺失 manifest 或 role.md），**不能悄悄回退扫描 WorkBuddy 冒充成功**。
- 内置目录必须只读；“安装”是将内置文件导出到可写用户专家目录，不是修改插件包自身。

---
## 6. DSH / DS-Bot 双宿主识别：禁止仅凭一个 key 下结论

### 6.1 区分三类信息

1. **插件是否运行在 DSH 中**：必然，因为新项目本身是 DSH 插件；`ctx`、`settings.section`、`webServer` 的可用性分别检测。
2. **DS-Bot 服务是否加载且可操作**：用同源 `api/bot` 的**能力探测**验证；存在 `localStorage` 旧值不说明 DS-Bot 正在运行。
3. **当前窗口的界面是否真的处于 Bot 模式**：可参考 DS-Bot `ds-bot:surface`，并根据当前入口所在的可见 UI 场景验证。这个 key 不是多窗口强一致的公开协议。

`DS-Bot/src/client/surface.js` 在 key 缺失时**默认 `bot`**；因此以下判断是错误的：

```js
// 错误：缺少 key、残留 key、另一个窗口改动，都可能误判
return localStorage.getItem('ds-bot:surface') === 'bot' ? 'bot' : 'agent'
```

### 6.2 推荐环境适配器返回值

```ts
// 文档性 TypeScript 接口，原项目为 JavaScript，实施时可用 JSDoc 表达
interface EnvironmentSnapshot {
  host: 'dsh';                       // 宿主是 DSH 体系
  dsBot: 'absent' | 'ready' | 'readOnly' | 'unknown' | 'incompatible';
  surface: 'agent' | 'bot' | 'unknown';
  operation: 'install' | 'createBot' | 'disabled';
  entry: 'harnessSettings' | 'botSidebar' | 'botOverlay';
  reason?: string;
}
```

### 6.3 模式判定优先级（建议的状态机）

| DS-Bot 能力探测 | 模式线索 / 入口 | 操作 | 备注 |
|---|---|---|---|
| 明确未安装（可识别的 404 / 无路由） | 任意 `ds-bot:surface` 残留值 | `install` | **DSH 本体不能受残留 Bot localStorage 影响** |
| `ready` | 当前为 DS-Bot 专用市场 overlay / Bot 侧边栏入口且确认该入口在 Bot UI | `createBot` | 创建前再次验证接口、模式、只读状态 |
| `ready` | 当前 DSH 原生 Agent 界面，`surface='agent'` | `install` | 与旧插件逻辑一致 |
| `ready` | `surface='bot'`，从 Harness 设置进入 | `createBot` | 须证明模式线索属于**本窗口**；多窗口不确定时先显示选择/刷新提示 |
| `readOnly` | Bot 界面 | `disabled`（显示“只读，无法创建”） | 不能误回退“安装”伪装成功 |
| `unknown`（网络异常、服务尚未就绪） | 任意 | `disabled` 或保留安全的已确认 Agent 操作 | **不能把网络错误等价于未安装** |
| `incompatible` | Bot 界面 | `disabled`，显示兼容性信息 | 不使用无验证的内部替代接口 |

**保守原则**：无法证明 Bot 创建条件具备就不执行 Bot 创建；无法证明用户在 Agent 界面就不自动把“创建”降级成“安装”。

### 6.4 能力探测实现注意点

DS-Bot 当前客户端实现中用 `POST api/bot` 调 `endpoint: 'state'`。它会返回 `bots`、`models`、`readOnly` 等数据，适合检查创建条件，**但它的实现可能在首次访问时初始化默认 Main Bot**。因此：

- **避免整个 DSH 页面启动时频繁调用 `state`**；仅在明确需要 DS-Bot UI/动作时做有界探测。
- 先检查是否存在 DS-Bot UI 线索或用户是否打开 Bot 市场，再对 `state` 发起探测，避免不必要的初始化副作用。
- 将 `404 / 合法 DS-Bot 协议返回 / 401 / 5xx / 网络超时 / 只读` 分开处理；不能一律 `catch -> agent`。
- 模式检查发生在页面打开、窗口 focus、可见性恢复、动作即将提交时；订阅 `storage` 只能作为额外线索，不能作为唯一机制。
- 一个来源是客户端状态，另一个是 Host `api/bot` 能力。**这两者没有公开的跨窗口原子性保证**；若多窗口交叉模式容易误判，则在不改 DS-Bot 的前提下设置“当前窗口模式确认”的保底确认步骤，禁止悄悄创建/安装。

### 6.5 UI 路由不必与操作规则耦合

不要创建两个不同的专家市场代码库。`ExpertMarket` 组件接受 `context.operation`：

```text
ExpertMarket
  ├─ SharedCatalogHeader   （统一数据、搜索、分类、详情）
  ├─ ExpertCard            （共用卡片信息）
  └─ ActionRenderer
       ├─ install           （Agent：安装/更新/卸载）
       ├─ createBot         （Bot：创建/已创建/再次创建）
       └─ disabled          （不兼容/只读/环境未知）
```

入口只是**提供操作意图**；服务层还需独立验证真实状态，不可因为前端传了 `operation='createBot'` 就绕过检查。

---

## 7. UI 入口设计：保持 DSH 原能力 + DS-Bot 左侧栏直接进入

### 7.1 Agent 模式保持原样

- 保留 `settings.section` 的“专家市场”设置入口。
- 保留 `conversation.input.left` 专家选择器和 `/expert` 命令。
- 原“安装 / 更新 / 卸载”按钮、安装状态标识及操作语义不改变。
- 改变的是**专家列表来源从“仅 WorkBuddy 本地”升级为“内置优先 + 可选来源”**。

### 7.2 Bot 模式增加独立入口（首选）

```text
DS-Bot 侧边栏
├── Bot / 群聊 / Agent 列表
├── ...
├── [专家市场]       ← WorkBuddy 插件注册的新操作，不修改 DS-Bot
├── [连接插件]       ← DS-Bot 原有内容，不覆盖
└── 账户 / 设置

点击专家市场
└── WorkBuddy 插件自己的弹窗（shell.overlay）
    ├── 搜索 / 分类 / 专家卡片 / Prompt 详情
    ├── 选择「产品研发专家」
    └── [创建 Bot]
        ├── 名称、角色、模型、Prompt 预览与可编辑确认
        └── 确认 → create-bot → 显示成功并在 Bot 列表可见
```

### 7.3 实施插槽

DS-Bot 当前在 `index.js` 中已使用：

- `sidebar.footer.action`（例如 `bot-account` 和 Agent 的 `bot-return`）；
- `shell.overlay`（例如 `bot`、`bot-signin`、`bot-toast`）。

新插件应通过现有 `slots.inject(...)` / `slots.register(...)` 注册唯一 ID 的入口和 overlay，使用与上游兼容的 slot options，例如：

```js
// 仅展示调用结构，不是可直接粘贴的生产实现；组件闭包和上下文由实际宿主适配。
const offButton = slots.inject('sidebar.footer.action', () =>
  slots.register({
    name: 'sidebar.footer.action',
    id: 'wb-dual-expert-market',
    order: -150,
  }, MarketLauncher)
)

const offOverlay = slots.inject('shell.overlay', () =>
  slots.register({
    name: 'shell.overlay',
    id: 'wb-dual-expert-overlay',
    order: 70,
  }, MarketOverlay)
)
```

注意：这些数字是**候选排序值**，而非已实机验证的“必定出现在连接插件正上方”。实施时需根据宿主 DOM / Slot 实际挂载点、优先级语义核验，不能以 CSS 假造另一入口。

### 7.4 生命周期与安全要求

- 新插件仅注册自己的 slot ID，不接管 `sidebar.workspaces` 整个列表，不替换 DS-Bot 的 `TeamSidebar`。
- 停用/卸载插件时释放 slot、事件、CSS、overlay、请求 AbortController；不可留下重复按钮。
- 弹窗符合 Esc 关闭、焦点管理、遮罩、滚动锁定、深浅主题、窄侧边栏/移动尺寸、键盘无障碍。
- 未进入 Bot 界面时，Bot 快捷入口应不显示或降级为“打开专家市场”而非误触创建。
- **不要修改 DS-Bot 的 `SettingsDialog`、左上角新建菜单、React 内部 Store；不要用 MutationObserver 给原生菜单插项目。**
- 插槽未暴露或加载失败时，Agent 市场仍通过 `settings.section` 可用；Bot 创建入口要报兼容性信息，不假装已经安装。

### 7.5 原生设置页不是本期目标

DS-Bot 自己的设置列表目前不是给任意第三方插件注册页面的稳定公开 API，**本方案不声称“把插件直接加到 DS-Bot 原生设置项”**。走的是 DSH 可扩展侧边栏与独立弹层；“Harness 设置 → 专家市场”作为可用备用路径，不作为最优入口。

---

## 8. 原有 DSH Agent 安装链路必须适配内置文件

### 8.1 不能只改 `catalog.list()`

原版 `export.js` 的导出逻辑不仅依赖卡片信息，还从**源插件目录**复制 Skills、计算源指纹，并写归属清单。若只让 UI 显示内置 `manifest.json`，不补充导出源适配，点击“安装”依然可能因找不到 `~/.workbuddy` 原路径而失败。

因此新增 `ExpertSourceAdapter` 统一接口（名称可调整）：

```ts
interface ExpertSourceAdapter {
  list(): Promise<ExpertSummary[]>;
  readPrompt(id: string): Promise<string>;
  readAsset(id: string, relativePath: string): Promise<Uint8Array>;
  listSkillFiles(id: string): Promise<Array<{ path: string; sha256: string }>>;
  fingerprint(id: string): Promise<string>;
  sourceRecord(id: string): Promise<SourceRecord>;
}
```

实现 `BundledSourceAdapter`（**默认必有**）、`UserSourceAdapter`（可选）、`LocalWorkBuddySourceAdapter`（默认禁用）。`createExporter` 不能再只接收源路径字符串，应能通过 Adapter 安全读取真实文件。

### 8.2 安装后产物

```text
<当前 DSH_HOME>/experts/<稳定导出 ID>/
├── expert.yml
├── role.md                       # 全量 Prompt
├── skills/                       # 允许复制的依赖
└── .expert-source.json           # 本插件拥有该目录的证据
```

导出来源清单应至少记录 `source=bundled|local|user`、`sourcePackage`、`sourceAgent`、`contentSha256`、`pluginVersion`、`importedAt`，并兼容旧版 `.expert-source.json`。不要因为来源由 `WorkBuddy 本地` 换成 `Bundled` 就直接删除用户已有专家目录。

### 8.3 更新与卸载规则

- `installed`：有本插件可识别的合法 ownership manifest 且文件存在。
- `updatable`：新内置资源 hash 与已安装来源 hash 不同，**只提示升级**，默认不静默覆盖用户可能编辑的文件。
- `uninstallable`：只有插件明确拥有的导出目录才允许卸载。
- `conflict`：用户手写文件夹、错误 manifest、第三方插件同名导出时拒绝自动覆盖。
- `orphan`：旧版本导出的专家在新资源库不存在时，仍可查询和有选择地处理，不能默认删除。
- **离线安装完整性**：安装后对导出的 `role.md`、必要 Skills 与元数据做 hash 校验，验证没有读 WorkBuddy 旧目录。

### 8.4 保持现有 DSH 服务边界

原版 `ctx.reflect.provide('experts', ...)`、registry、命令和会话切换机制可以继续沿用，但只能从**已导出到 DSH 的专家文件夹**建立可执行专家列表；“市场内置但尚未安装的模板”不能假装已经是可切换的 DSH Agent。这样保持“市场模板”与“DSH 已安装专家”概念分离。

---

## 9. DS-Bot 创建链路：以专家模板创建**真正的原生 Bot**

### 9.1 调用协议（当前版本）

浏览器端使用文档相对路径，兼容宿主在反向代理子路径部署的情况：

```http
POST api/bot
Content-Type: application/json

{
  "endpoint": "create-bot",
  "payload": {
    "name": "产品研发专家",
    "role": "产品研发顾问",
    "instructions": "<来自内置 role.md 的真实完整内容>",
    "model": "<用户选择的 DS-Bot 当前模型引用，可省略>"
  }
}
```

不要在生产代码里把 `instructions` 写成“这里填完整提示词”这样的占位符；**必须从真实打包资源读取并填入**。请求体字段来自 DS-Bot 当前 `channel.js`，在未来版本可能改变。

### 9.2 Bot 创建适配器建议

```js
async function callDsBot(endpoint, payload, signal) {
  const response = await fetch('api/bot', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint, payload: payload ?? null }),
    signal,
  })
  if (!response.ok) throw new Error(`DS-Bot HTTP ${response.status}`)
  const result = await response.json()
  if (typeof result?.ok !== 'boolean') throw new Error('DS-Bot response format incompatible')
  if (!result.ok) {
    const error = new Error(result.error?.message ?? 'Bot request failed')
    error.code = result.error?.code
    throw error
  }
  return result.value
}
```

它只是协议骨架；实际实现增加超时、取消、兼容探测、日志脱敏、只读校验、模型下拉选项、重复点击锁、操作状态和 UI 刷新。不能把内部协议视为永远稳定。

### 9.3 字段映射及可降级规则

| 内置专家字段 | DS-Bot 字段 | 规则 |
|---|---|---|
| `displayName` | `name` | 用户可编辑，trim 后至多 40 字符；DS-Bot 拒绝重名，因此创建前提示并支持改名 |
| 专家职业/类型 | `role` | 用户可编辑，至多 24 字符；优先职业而不是角色正文第一段 |
| 完整 `role.md` | `instructions` | **必须原样保留有意义指令内容**，不能用专家简介或开场白替代 |
| 专家头像文件 | `avatar` | DS-Bot 当前接受符合规则的数据 URL，字符串大小受 `MAX_AVATAR_IMAGE`（160000）限制；大图先经允许的图片处理、压缩或降级为默认头像 |
| 用户当前可用模型 | `model` | 从 `state.models` 选择合法 ref；未选时交给 DS-Bot 默认模型处理；不能把模型显示名当 ref |
| 专家分类/标识 | 本插件映射记录 | 不把任意自定义字段混塞 `create-bot`，在本插件独立记录 `sourceExpertId → botId` |
| Skills / MCP /连接器 | 本期不自动映射 | 提示“仅角色 Prompt 已导入”；能力必须走 DS-Bot 既有能力体系单独授权与设置 |

### 9.4 创建步骤（严格顺序）

1. 用户打开 Bot 专家市场并点击目标专家的“创建 Bot”。
2. 验证真实内置 Prompt 存在、非空、hash 与 manifest 一致。
3. 读取 DS-Bot 状态，检查接口格式、只读、模型、已有 Bot 名称。
4. 打开确认弹窗：显示名称、角色、模型、头像与**完整可查看**的 Prompt，提醒 Skills 不自动生效。
5. 用户确认后再次验证环境和防重复锁，然后发出**唯一一次** `create-bot`。
6. 收到结构正确的 `ok: true` 和 Bot 实体/ID；保存本插件本地映射，更新“已创建”。
7. 调用 `state` 或依赖 DS-Bot 自有同步机制验证新 Bot 出现在 `bots` 中；若列表同步有延迟，给“创建成功，正在同步”而非无限重复提交。
8. 出错时恢复按钮与错误提示；若请求网络超时但可能已提交，**先读取 Bot 列表核对，再允许重试**，避免重复创建。

### 9.5 重名/重复/修改的正确语义

- DS-Bot 自身拒绝同名 Bot；点击创建前应展示名称已占用。
- 一个专家允许多个 Bot，但第二个需**主动选择不同名称**；不能重复点击创建原名得到报错风暴。
- “已创建”状态由当前实际 `bots` 列表和本插件映射共同验证，不能只靠 `localStorage` 的成功标记。
- **用户删除 Bot 后**该模板应恢复可创建状态；**用户改名后**以 Bot ID 识别，不能因为名称变化丢失关联。
- 更新专家资源不会静默重写既有 Bot 的 `instructions`。未来要做“同步专家到已有 Bot”，必须单独明确确认和冲突策略。
- 卸载 WorkBuddy 插件不得删除已经创建的 DS-Bot 实例。

### 9.6 安全及权限

- 必须使用宿主同源、已登录且拥有当前 profile 权限的 API；不得对用户配置的任意外部 URL 携带凭据调用。
- **只读状态 `readOnly` 禁止创建**；服务不可用时禁用按钮并提供诊断。
- 禁止直接修改 DS-Bot `state.json`、SQLite、私有会话文件来“补创建”。
- 不在日志、埋点、错误消息中打印完整 Prompt、Token、API Key 或 Skills 脚本内容。
- 需要外部连接器/工具的专家不得误标“全部能力已经安装”；与此相关的权限需要 DS-Bot 的用户授权机制。

---

## 10. DS-Bot 独立桌面应用：不能“理论兼容”代替实际兼容

### 10.1 两个安装宿主必须分别测试

DS-Bot 文档确认独立桌面应用**自带 DSH**，不要求先安装外部 DSH；其 `app/package.json` 还明确锁定内嵌 DSH 版本。原版 `dsh-workbuddy-expert` 的 DSH peer 兼容范围为 `>=0.2.0-rc.2 <0.3.0`，**理论范围覆盖当前嵌入版本，不等于插件安装、动态加载、前端 UI 插槽一定成功**。

因此要做两次实装：

- **普通 DSH**：从同一个 `.tgz` 安装/启用新插件 → Agent 安装功能正常 → 再安装 DS-Bot 插件，验证两模式。
- **独立 DS-Bot Desktop**：在该独立应用**自己的插件管理/内嵌 DSH 配置**中找到有效的第三方插件安装方式，安装**同一个 `.tgz`**；验证专家包文件在独立应用环境可见，Bot/Agent 切换后行为正常。

如果独立应用某个发行版本**没有允许安装用户第三方插件的入口**，不能把普通 DSH 中安装成功当作独立应用已支持；此时按 P0 **阻塞问题**记录，不允许宣称“独立应用已兼容”，也不以修改 DS-Bot 核心包作为默认偷渡解决方案。可以评估它公开的 Harness 设置/插件管理路径，但必须有实际安装证据。

### 10.2 Profile / 存储边界

- 同一台电脑可能同时运行：用户 DSH Desktop、DSH Web、DS-Bot 独立桌面 App；它们可能拥有不同的 profile 和 `DSH_HOME`。
- 插件读取/写入**当前 Host 的 profile**，不得硬编码写外部 `~/.dsh`，更不得默认扫描另一个程序的安装目录。
- 资源目录从插件自身模块位置解析；`role.md` 导出目标从当前 Host 的 DSH Home 解析。
- 测试在 Windows/macOS/Linux 至少各一个可复现宿主组合（CI 环境条件允许时自动化，不可自动的提供人工实机证据）。

### 10.3 功能降级与错误可观测性

- **内置市场可用，Bot UI 插槽失败**：DSH Agent 功能可继续使用；Bot 创建入口提示“当前宿主缺少可用入口”，标为兼容性问题。
- **内置市场可用，Bot API 不可用**：Bot 创建禁用；不能静默改为 DSH 安装。
- **DS-Bot 不存在**：插件仍作为纯 DSH 专家插件完全可用。
- **独立 App 无第三方插件安装能力**：标记发布阻塞，输出复现步骤和具体版本，而不是要求用户自行修改 DS-Bot 安装文件。

---

## 11. 功能分层、资源状态和性能边界

### 11.1 明确三种独立状态

```text
专家模板：bundled / local / workbuddy        ← “这个专家资料是否可浏览”
DSH 安装态：not-installed / installed / updatable / broken
DS-Bot 实例态：not-created / created / unavailable / read-only
```

不要共享一个 `installed` 字段来表示“已装为 DSH 专家”和“已创建 DS-Bot”，否则两个模式互相污染。

### 11.2 性能要求

- 读取 `manifest.json` 后即可渲染卡片列表；**不要在首次页面展示时同步读取所有专家完整 Prompt 和所有 Skills**。
- Prompt 按详情或创建时按需加载；小图资源独立 URL 请求并限制并发。
- 为资源清单提供 bundle 版本与 hash；内置源稳定不变，运行时不要每次进行 429 个目录的深层 `stat()` 扫描。
- 搜索按名称、职业、分类、标签过滤；可在前端利用轻量索引，不需要独立数据库。
- 配置变更、可选本地源刷新和 Bot 创建状态应只更新相关视图；请求不可导致市场卡片丢失。
- 所有完整 Prompt/附件读取应具备路径白名单和文件尺寸限制；不把资源读取接口做成任意文件读取代理。

### 11.3 版本升级策略

- **插件版本**与**内置专家库版本**分离，记录 `pluginVersion` / `bundleVersion` / `sourceRevision`。
- V1 内置源改为 V2 时，比较内容 hash，仅显示“有更新”；不能破坏已安装专家或已创建 Bot。
- 历史通过旧 `dsh-workbuddy-expert` 导出的 `.expert-source.json` 应视为可迁移对象，迁移前备份与判定；不得在同一目标目录把不同所有者文件覆盖。
- 旧插件同时启用可能产生 `ctx.experts` 服务冲突、重复选择器和两个设置页，应明确**迁移安装顺序/互斥检查**。
- 记录每个兼容宿主的真实版本号、可用槽位、接口返回 schema 与测试结果；升级后执行回归，而不是凭版本字符串一刀切。

---

## 12. 完整兼容性与离线验收矩阵（必须逐项执行）

### 12.1 必须测试的环境组合

| 编号 | DSH / DS-Bot 配置 | 外部 WorkBuddy | 联网 | 预期关键结果 |
|---|---|---|---|---|
| E01 | 纯 DSH Desktop | **未安装** | **断网** | 内置专家显示、Prompt 可预览、安装成功、`/expert` 可用 |
| E02 | 纯 DSH Web | **未安装** | **断网** | 与 E01 一致；反向代理相对路径可用 |
| E03 | DSH Desktop + DS-Bot 插件，Agent 模式 | 未安装 | 断网 | 保留“安装”、选择器及切换 |
| E04 | DSH Desktop + DS-Bot 插件，Bot 模式 | 未安装 | 断网 | 侧边栏专家市场、创建 Bot、保存 Prompt、Bot 列表可见 |
| E05 | DSH Web + DS-Bot 插件，Bot 模式 | 未安装 | 断网 | 与 E04 一致 |
| E06 | **DS-Bot 独立桌面应用**，Bot 模式 | 未安装 | 断网 | 可安装同一个插件包、入口可见、能创建 Bot |
| E07 | **DS-Bot 独立桌面应用**，Agent 模式 | 未安装 | 断网 | 同一个插件包显示“安装”、专家切换可用 |
| E08 | 原版 DSH 中留有 `ds-bot:surface=bot`，但 DS-Bot 未安装 | 未安装 | 断网 | 不误显示“创建 Bot” |
| E09 | DSH + DS-Bot，Bot 接口只读 | 任意 | 任意 | 可以浏览专家，但禁用创建，明确提示只读 |
| E10 | 同一浏览器两个窗口分别在 Agent/Bot 模式 | 未安装 | 任意 | 不发生模式串线；不确定时要求确认并禁用危险动作 |
| E11 | 打包后删除外部 `vendor-input/` 与 WorkBuddy 数据目录 | 不存在 | 断网 | **仍然正常运行**，没有隐式在线回源 |
| E12 | 用户已有同名手写 DSH expert / 已有同名 Bot | 任意 | 任意 | 不覆盖手写文件、不静默重复建 Bot |
| E13 | 删除已创建 Bot，重开市场 | 任意 | 任意 | 模板仍在，允许再次创建；旧映射不误导 |
| E14 | 卸载新插件 | 任意 | 任意 | DSH/DS-Bot 不崩溃，已经创建的 Bot 不被删除，slot 不残留 |
| E15 | 原版插件已有导出专家，迁移到新插件 | 任意 | 断网 | 用户专家目录可备份、可识别、不丢失、不被无授权覆盖 |
| E16 | 原版插件和新版插件同时启用（负面用例） | 任意 | 任意 | 明确冲突提示或避免重名注册，不产生不可恢复状态 |

### 12.2 离线资源专项断言

- `npm pack` 的 `.tgz` 中存在 `resources/experts/manifest.json` 且至少含实际许可通过的专家条目。
- manifest 中每一条 `ready` 专家都有文件可读的完整 `role.md`，**不是只有名称和描述**。
- 所有文件的 manifest hash 与磁盘内容匹配。
- 移走/重命名目标机器 `~/.workbuddy`，市场仍与内置清单数量一致。
- 抓取/拦截网络请求证明没有向 `workbuddy.cn`、GitHub、CodeBuddy CDN 获取专家资源。
- Agent 安装后验证 `expert.yml + role.md + .expert-source.json` 并能在会话选择器出现；若允许 Skills，至少一项真实附件可按预期复制。
- Bot 创建后与其实际 `instructions` 比对，确保来自原完整 `role.md`，无截断或摘要替代。
- 资源授权不足导致无法发布全部内容时，测试报告**明确标记未达成“全量资源发布”**，而非视为正常完成。

### 12.3 API/回归专项用例

- DS-Bot API 404、HTTP 500、非法 JSON、超时、服务重启、版本 schema 变化。
- `bot/read-only`、Bot 重名、模型不可用、无模型但默认流程允许创建、创建返回后客户端列表刷新延迟。
- 用户连续双击“创建 Bot”、请求中断但服务器已成功创建时的恢复流程。
- 长 Prompt、中文 Prompt、特殊 Markdown、含 `{}` / 反引号 / 模板语法的 Prompt，确保原文完整保留。
- 头像文件缺失、图片尺寸超过 `MAX_AVATAR_IMAGE`、不支持的图片格式。
- 插件热启用、禁用、卸载及模式来回切换后，不出现第二份侧边栏按钮或多次请求。
- 原有 `settings.section`、`conversation.input.left`、`/expert`、Export 更新卸载全部回归。

### 12.4 什么证据算“已经兼容”

**只有源代码可注册 slot 或 `peerDependencies` 范围匹配，不算 E06/E07 通过。** 每个实机组合必须有：DSH 及 DS-Bot 版本、插件包 hash、安装方式、关键操作录像/截图或日志、Bot/Agent 文件状态、问题与结论，写入 `docs/verification-report.md`。

---

## 13. 建议实施阶段（严格先数据、再兼容、后 UI）

### Phase 0：复制源码与依赖、宿主探针（阻塞门槛）

**任务**：

1. 复制原 `dsh-workbuddy-expert` 完整项目，保留 LICENSE 和原归属；新建独立包名、命名空间。
2. 锁定三个仓库的 **commit SHA** 与依赖版本，记录 `docs/upstream-lock.json`；不要凭 `main` 在实施中途漂移。
3. 在 DSH Desktop、DSH Web、DS-Bot 插件模式中验证源插件能启用，确认 Slot 生命周期。
4. 在 DS-Bot **独立桌面应用**中实际验证第三方插件安装方式、`sidebar.footer.action`/`shell.overlay` 可见性、`api/bot` 访问以及 profile 路径。
5. 用最小无业务逻辑按钮/弹窗完成可视化冒烟，不开始资源迁移前先确认最脆弱的独立应用限制。

**交付**：`upstream-lock.json`、`compatibility-matrix.md`、4 种环境的 P0 冒烟记录。

**门槛**：如独立桌面 App 不支持第三方插件安装，必须明确阻塞/决策，不许直接写“兼容”或绕过用户批准偷偷修改其安装包。

### Phase 1：全量资源盘点、转换与可发行内置包（本次最重要）

**任务**：

1. 固定 `workbuddyskills` 输入快照，对全部专家目录/Agent 文件/元数据引用进行盘点。
2. 实现 Agent Prompt、规则、头像、Skills 标准化转换；逐一记录无效项与原因。
3. 对授权、敏感数据、危险脚本和外部依赖执行审核，形成许可证证据清单。
4. 在 `resources/experts` 中生成实际文件与 manifest；改 package files；生产 `.tgz`。
5. 在干净断网环境删除 WorkBuddy 后安装 `.tgz`，验证 **E01/E02/E11**。

**交付**：构建脚本、完整 inventory / conversion / license / pack report、真实内置资源包、离线测试结果。

**门槛**：只有索引、网络下载器或几个占位示例**不算 Phase 1 完成**；全量目标如因版权阻塞必须明确列出阻塞数量。

### Phase 2：原 DSH 专家链路完整回归

**任务**：

1. 引入 `BundledSourceAdapter` 并改造 exporter 读取真实源文件。
2. 维护安装 ownership manifest、更新/卸载、防覆盖；保留旧版 `/expert` 和会话选择器。
3. 处理历史源清单、旧插件共存检测与迁移。
4. 完成 E01/E02/E03/E08/E12/E15/E16。

**交付**：DSH 本体完全可用的**离线插件**，且不依赖 DS-Bot。

### Phase 3：DS-Bot 专家创建与双模式

**任务**：

1. 建立环境/模式适配器，明确 absent/ready/readOnly/unknown/incompatible。
2. 增加 `BotTemplateAdapter`、Bot 创建确认弹窗、`api/bot` 客户端，保存并核对映射。
3. 以统一 `ExpertMarket` 组件切换安装/创建行为；不能共用安装状态字段。
4. 验证重名、只读、模型、头像、请求不确定、列表刷新；完成 E04/E05/E09/E10/E12/E13。

**交付**：Bot 模式真正创建并管理 DS-Bot 原生 Bot；Agent 模式原能力不变。

### Phase 4：侧边栏 UI、独立桌面端与发布

**任务**：

1. 注册 `sidebar.footer.action`、`shell.overlay`，与 DS-Bot 自带账户栏、弹窗共存。
2. 按实际宿主验证按钮显示、位置、主题、焦点、缩放、热卸载与路由前缀。
3. 在 DS-Bot 独立桌面应用安装**与 DSH 相同 hash 的 `.tgz`**，完成 E06/E07/E14。
4. 输出更新/迁移说明、用户使用手册、兼容矩阵、版本冻结与发行包 hash。

**交付**：一份安装包 + 源码 + 报告；同时证明“DSH 原生 Agent”和“DS-Bot Bot”双环境真实可用。

---

## 14. 工程质量与边界（防止 AI 把代码做成屎山）

1. **不要 fork DSH 或 DS-Bot**。上游只用于接口核查和测试，不在其源码目录做持久化改动。
2. **保留现有目录与能力，渐进增加适配器**，不得为了新功能重写 registry、switch、所有客户端样式。
3. **模块单一职责**：扫描归档属于 build scripts；运行时内置索引属于 catalog；UI 动作属于 controller；Bot 协议属于 `dsbot-api.js`；DSH 导出属于 installer/exporter。
4. **不允许在组件里写 Node 文件系统读取或把 Bot HTTP 请求复制三处**；所有访问都通过 service/adapter。
5. **输入输出强校验**：每个专家 DTO、manifest、Bot 返回结构有统一 Schema；失败单项隔离，不让一个坏包拖垮所有专家。
6. **来源/授权/版本可追溯**：每个可发布专家具有上游路径、SHA、授权依据、内容 hash；严禁捏造内容。
7. **默认安全**：浏览专家不会执行 Skills、打开外部应用、联网加载未审查图片；任何外部连接器激活都必须单独授权。
8. **测试必须执行而非仅写测试清单**：至少单元测试、集成测试、`npm pack` 解包校验和宿主实测。
9. **新宿主版本只通过验证后纳入支持矩阵**，不要擅自扩大原 `engines.dsh` 声明。
10. **文档与实现一致**：任何 API 变化/被迫降级/未达标的离线资源必须反映到 README 和验证报告。

---

## 15. 可直接给 AI 编程 Agent 的执行指令

> 请复制本段作为 AI Agent 的任务指令，并将整份 V2.0 文档放入新仓库 `docs/` 供 Agent 逐章引用。**本段不授权修改 DSH 或 DS-Bot 仓库。**

```text
任务：以 https://github.com/pbwheel/dsh-workbuddy-expert 的源码副本为基础，
开发一个真正离线内置专家库、同时兼容 DSH 本体和 DS-Bot 的单一插件。

一、严格遵守 docs/WorkBuddy专家市场双宿主兼容与离线内置改造技术方案_V2.0.md。
二、先锁定三仓 SHA；先做 Phase 0 验证 DS-Bot 独立桌面端能否安装第三方插件，
    以及 sidebar.footer.action / shell.overlay 是否可正确显示。
三、必须把符合授权的真实专家文件和完整 role.md 打包进插件 resources/experts，
    运行时绝不能依赖本机 WorkBuddy、用户预先下载专家、GitHub、WorkBuddy CDN。
    workbuddyskills 仅用作构建输入；全面盘点、转换、核对、审核、生成真实资源包。
四、Agent 模式必须保留原“安装/更新/卸载”、/expert、会话选择器行为；
    Bot 模式在 DS-Bot 左侧栏提供“专家市场”，点击“创建 Bot”后将完整 Prompt
    经当前 DS-Bot 的 api/bot create-bot 接口真正写入原生 Bot。
五、同一个 .tgz 同时安装在普通 DSH 和 DS-Bot 独立桌面内嵌 DSH 中；
    不能假设共享数据目录，也不得创建第二套 Bot 版分叉项目。
六、不准修改 DSH 或 DS-Bot 上游源码，不准 DOM 注入、不准直接写 DS-Bot 数据文件。
七、禁止只用 localStorage 一个 key 判定模式；必须实现能力探测、只读/未知降级、
    多窗口安全处理；不允许静默创建、覆盖或删除既有专家/Bot。
八、严格实施 Phase 0→4，每阶段输出实际文件列表、测试证据和未解决问题。
九、必须执行 E01～E16 测试；必须验证 npm pack 实际包含完整专家文件并离线可用。
十、如遇版权未授权、DS-Bot 独立应用不允许安装第三方插件、无稳定 UI 插槽等阻塞，
    必须准确报告“未达到验收目标”，不要用空壳页面/改造宿主/网络回退宣称完成。

输出：新插件源码、离线可安装包、资源转换与授权审核报告、测试报告、兼容矩阵、
      迁移与发布说明。仅在全部硬性验收通过时标记正式可发布。
```

---

## 16. 验收清单（最终签字标准）

- [ ] 开发基线从 **完整复制的** `dsh-workbuddy-expert` 出发，保留许可和原功能。
- [ ] 三仓 SHA 固定、上游接口和版本的 `compatibility-matrix.md` 有证据。
- [ ] **真实内置专家**完整存在于 `.tgz`，含有效 Prompt/元数据/许可附件；资源报告真实。
- [ ] **完全不装 WorkBuddy、断网**时可浏览、预览、安装 Agent 专家；运行时 0 次依赖 WorkBuddy 网络或用户落盘资源。
- [ ] 普通 **DSH Desktop + DSH Web** 单独安装插件，Agent 操作正常。
- [ ] **DSH + DS-Bot 插件**分别在 Agent 与 Bot 模式下行为正确，能快速切换且不串线。
- [ ] **DS-Bot 独立桌面应用**已实装相同插件包，Bot 和 Agent 两种界面均有实测通过记录。
- [ ] Bot 模式侧边栏出现“专家市场”，弹窗中为“创建 Bot”，不影响 DS-Bot 原有菜单。
- [ ] 从真实 `role.md` 创建的 Bot 保留完整 `instructions`、名称/角色/模型规则正确、列表可见。
- [ ] 旧专家安装、用户手写专家、Bot 实例不被新插件覆盖或误删。
- [ ] 只读、无插件、路由不可达、未知模式、多窗口及资源缺失均有明确降级。
- [ ] 严格遵守第三方资源分发约束；无法获授权时公开说明目标阻塞，不夸称“内置全部专家”。
- [ ] 测试矩阵 E01～E16 有实际结果，非仅勾选的规划清单。

---

## 17. 上游参考与后续维护入口

**基础插件**

- 仓库：https://github.com/pbwheel/dsh-workbuddy-expert
- 包结构：https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/package.json
- Host 主入口：https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/src/index.js
- 扫描器：https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/src/importer/scanner.js
- 导出器：https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/src/importer/export.js
- 前端市场及插槽：https://github.com/pbwheel/dsh-workbuddy-expert/blob/main/client/client.js

**专家资源归档**

- 仓库与授权声明：https://github.com/infometa/workbuddyskills
- 资源分类及数量：https://github.com/infometa/workbuddyskills/blob/main/CATALOG.md
- 专家元数据：https://github.com/infometa/workbuddyskills/blob/main/experts/expert_center.json

**DS-Bot**

- 仓库：https://github.com/Fei2411/DS-Bot
- 插件包：https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/package.json
- 独立桌面应用包：https://github.com/Fei2411/DS-Bot/blob/main/app/package.json
- 客户端 UI 插槽：https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/client/index.js
- 模式读取：https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/client/surface.js
- 客户端 API 协议：https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/client/api.js
- Bot 操作路由：https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/host/channel.js
- Bot 创建规则：https://github.com/Fei2411/DS-Bot/blob/main/ds-bot/src/host/roster.js
- 安装与独立桌面说明：https://github.com/Fei2411/DS-Bot/blob/main/README.zh.md

> **实施结束时务必将上述易变的 `main` 链接替换/补充为三仓实际锁定的 commit permalink**，并保留精确的运行验证记录。

---

### 最终方案判定

本项目应当最终成为一个**“真正的离线内置专家模板库 + DSH Agent 安装器 + DS-Bot 原生 Bot 创建器”**，不是简单把旧插件的按钮文字从“安装”改成“创建”。只有资源在包内、两套宿主安装路径真实验证、Agent 原能力回归、Bot 原生创建可用、且相关内容可合法发布，才叫完成 V2.0。
