# DSH WorkBuddy Expert Plus

**一个插件，两套宿主动作：DSH Agent 专家安装 + DS-Bot 原生 Bot 创建；专家模板全部离线内置。**

本包基于 MIT 的 `pbwheel/dsh-workbuddy-expert`，保留原有 `/expert` 命令、
会话专家选择器、专家目录导出与卸载能力，并新增 DS-Bot 双模式适配。

## 功能

- **离线内置专家市场**：读包内 `resources/experts`，目标机器无需安装
  WorkBuddy、无需联网，也不会回源 GitHub/WorkBuddy CDN。
- **Agent 模式**：安装/更新/卸载专家到当前 DSH profile 的 `experts/`；
  安装后 `/expert` 与会话选择器可见。
- **Bot 模式**：DS-Bot `sidebar.footer.action` 入口打开插件自有弹层；
  选择专家后读取**完整 role.md**，确认后调用 `POST api/bot create-bot`。
- **模式隔离**：Agent 与 Bot 状态字段分离；切换模式不自动安装、创建、
  删除或迁移对象。
- **保守能力探测**：`absent` / `ready` / `readOnly` / `unknown` /
  `incompatible` 分开处理；只读或未知时禁用 Bot 创建，不静默降级为安装。
- **原能力保留**：`/expert`、输入框专家选择器、`settings.section` 市场页、
  导出 ownership manifest、防覆盖与 uninstall 校验。

## 安装

```bash
# DSH Desktop / Web：从生成的 tarball 安装（示例）
dsh plugin --profile web add /absolute/path/to/dsh-workbuddy-expert-plus-0.1.0.tgz
```

DS-Bot 独立桌面应用需在其自身的 DSH 插件管理/配置中安装**同一个** `.tgz`；
其 profile 与外部 DSH 不共享。若该版本不允许第三方插件安装，应以兼容性
阻塞记录，而不是修改 DS-Bot 安装包。

## Agent 使用

1. 打开设置中的「WorkBuddy 专家市场」。
2. 浏览内置专家、查看完整 Prompt。
3. 点击「安装」。专家会导出到当前 DSH profile 的 `experts/`。
4. 在 `/expert` 或会话专家选择器中使用已安装专家。

## Bot 使用

1. 在 DS-Bot Bot 界面点击侧边栏「专家市场」。
2. 选择专家并点击「创建 Bot」。
3. 检查/编辑名称、角色，查看完整 Prompt。
4. 再次确认后创建；成功后显示 Bot ID，原模板保留，可再次创建不同名称的 Bot。

Skills/MCP/连接器**不会自动映射**到 Bot；本期只导入完整角色 Prompt。

## 资源与授权状态

构建输入固定为 `infometa/workbuddyskills@7ea565af29f6bede2acc0d7b55daa300db5de3f8`。

- 429 个索引专家 + 729 个顶层 Agent 已盘点；
- **39 个**具有 Prompt 级明确许可证据并已打包完整资源；
- **390 个**因缺少可再分发授权被阻断；
- 300 个未索引 Agent 记录在报告中，没有静默丢弃或伪造。

因此本包**不声称**已内置全部 429 个专家；全量目标被授权条件阻塞。
详见 `docs/resource-audit.md` 和 `build/reports/license-audit.json`。

## 开发与验证

```bash
npm run build:experts   # 重建资源与审计报告
npm test                # 单元/集成测试 + 原插件 smoke
npm run check:package   # npm pack、解包、逐文件 hash、离线 catalog 校验
```

环境组合与实机验证状态见 `docs/compatibility-matrix.md` 和
`docs/verification-report.md`。没有实机证据的组合明确标记为未验证，而不是
用单元测试替代。

## 许可

插件代码沿用原项目 MIT 许可，见 `LICENSE`。打包的专家内容仅纳入有明确
Prompt 级许可证据的条目；`license/` 下的依赖许可证不被当作专家 Prompt 的授权。

本项目为社区插件，并非 DeepSeek 官方产品。
