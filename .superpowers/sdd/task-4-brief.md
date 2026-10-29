### Task 4: 全量回归、真实主题视觉验收与证据记录

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/docs/verification-report.md`（追加一行验收记录）
- Test: `packages/dsh-workbuddy-expert-plus/test/*.test.js`（只运行，不改）
- Artifact: `output/playwright/launcher-options.png`（已存在的方案 B 参考图，不打包）
- Installed profile (只替换本 profile 的 plugin 安装，不改 DS-Bot 本体): `C:\Users\guojl\.dsh\profiles\ds-bot\package.json`

**Interfaces:**
- Consumes: Task 2/3 的 `.wbx-launcher` 展开/折叠态与 `data-wide`。
- Produces: 全量测试通过输出、`npm run check:package` 的 `"ok": true` JSON、verification report 中一条带命令与证据的 2026-10-29 记录，以及一张用真实 DSH token 渲染的最终视觉截图。

**实机安装说明（本机现状）：** DS-Bot profile 的 `package.json` 依赖是
`"dsh-workbuddy-expert-plus": "file:D:/code/ai/dsh-workbuddy-expert/packages/dsh-workbuddy-expert-plus/build/dsh-workbuddy-expert-plus-0.1.1.tgz"`，
即它消费的是**已打包的 tgz**，不是本仓库源码。只改源码不会改变正在运行的 DS-Bot。验收必须先把新 tgz 装进 profile，然后重启 DS-Bot 让新 bundle 生效。

- [ ] **Step 1: 运行全量测试**

Run:

```bash
cd packages/dsh-workbuddy-expert-plus && npm test
```

Expected: `ℹ tests` 计数 ≥ 89、`ℹ fail 0`，并看到 `smoke: all checks passed`、`smoke-client: all checks passed`、`smoke-importer: all checks passed`、`smoke-install: all checks passed`。把完整输出留到记录里，不只记“通过”。

- [ ] **Step 2: 运行包完整性检查**

Run:

```bash
cd packages/dsh-workbuddy-expert-plus && npm run check:package
```

Expected: 末尾 JSON 含 `"ok": true`，且 `files` 计数与改动前一致（本计划只改 `client/client.js` 与测试，不新增打包文件）。若 `"ok": false`，读取 `errors` 数组修复后重跑，不要跳过。

- [ ] **Step 3: 用真实 token 渲染三态截图**

用 `output/playwright/launcher-options.html` 已实现的浅色/深色/折叠规格，确认最终实现与参考图一致：按钮为 32px 高、999px 圆角、1px 描边、左侧星形图标、右侧箭头；折叠为 36×36 纯图标。启动本地静态服务并截图：

```bash
cd /d/code/ai/dsh-workbuddy-expert
node -e "const http=require('http'),fs=require('fs');http.createServer((q,r)=>{try{const p=decodeURIComponent(q.url.split('?')[0]);r.writeHead(200,{'content-type':'text/html; charset=utf-8'});r.end(fs.readFileSync('output/playwright'+p))}catch(e){r.writeHead(404);r.end('no')}}).listen(8891,'127.0.0.1')" &
sleep 1
export CODEX_HOME="${CODEX_HOME:-$HOME/.codex}"
export PWCLI="$CODEX_HOME/skills/playwright/scripts/playwright_cli.sh"
"$PWCLI" -s=wbverify open "http://127.0.0.1:8891/launcher-options.html"
"$PWCLI" -s=wbverify resize 1200 900
"$PWCLI" -s=wbverify screenshot --full-page
```

Expected: Playwright 输出截图路径；图片中三列分别展示浅色常态、浅色悬停、深色常态、折叠态，方案 B 的胶囊在深色下有可见边框、折叠后只剩图标。人工核对后把截图复制为 `output/playwright/launcher-options-final.png`。

- [ ] **Step 4: 把新包装进 DS-Bot profile**

先确认 0.2.1 的 tgz 已经包含 Task 2/3 的源码（`check:package` 会重新 pack 当前工作树；不要复用 10 月 28 日的旧包）。然后：

```bash
cd /c/Users/guojl/.dsh/profiles/ds-bot
cp package.json package.json.bak-before-pill
node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.dependencies['dsh-workbuddy-expert-plus']='file:D:/code/ai/dsh-workbuddy-expert/packages/dsh-workbuddy-expert-plus/build/dsh-workbuddy-expert-plus-0.2.1.tgz';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\n')"
npm install --no-audit --no-fund
```

Expected: `npm install` 退出码 0，`node_modules/dsh-workbuddy-expert-plus/client/client.js` 中出现 `wbx-launcher-caret` 与 `border-radius: 999px`。用下面的命令自证：

```bash
grep -n "wbx-launcher-caret\|border-radius: 999px" /c/Users/guojl/.dsh/profiles/ds-bot/node_modules/dsh-workbuddy-expert-plus/client/client.js
```

Expected: 至少命中 `wbx-launcher-caret` 一行、`border-radius: 999px` 一行；若没有，说明 tgz 是旧包，回到 Step 2 重跑 `check:package`。

- [ ] **Step 5: 重启 DS-Bot 并实机核对**

关闭并重新启动 DS-Bot 桌面应用（不是刷新网页），切到 Bot 模式，查看侧栏底部入口：

- 展开态应为 32px 高、999px 圆角、1px 描边，左侧星形图标 + `WorkBuddy 专家` + 右侧箭头。
- 收起侧栏后应为 36×36 的纯图标圆钮，不出现文字残影或布局抖动。
- 在 DS-Bot 设置里切换亮/暗主题，入口边框与底色应随主题变化，不需要重开面板。

如果实机效果与参考图不一致，记录实际现象和截图，不要改验收结论为通过。

- [ ] **Step 6: 追加验收记录**

在 `docs/verification-report.md` 末尾追加（保留既有格式；把命令输出中的真实计数填进占位处，不允许留占位符）：

```markdown
## 2026-10-29 — Bot 侧栏入口方案 B（描边胶囊）

- 变更：`client/client.js` 的 `BotMarketLauncher` 改为 32px 描边胶囊（图标 + `nav` 文案 + 箭头），并用 `sidebar.footer.action` 的 `wide` owner prop 驱动 `data-wide`；`data-wide="false"` 收为 36×36 纯图标。颜色全部来自 DSH token，亮/暗与第三方主题切换无需重渲染。
- 契约测试：`node --test test/client-bot-ui.test.js test/client-surface.test.js` — 全部通过（新增 3 条入口断言）。
- 全量回归：`npm test` — N tests, 0 fail；四条 smoke 全部通过。
- 打包完整性：`npm run check:package` — `"ok": true`，`files` = N。
- 实机安装：DS-Bot profile 的 tgz 已指向 `build/dsh-workbuddy-expert-plus-0.2.1.tgz`，`node_modules` 内的 bundle 含 `wbx-launcher-caret`；重启 DS-Bot 后展开/折叠/亮暗三态已人工核对。
- 视觉证据：`output/playwright/launcher-options-final.png`（浅色常态、浅色悬停、深色常态、折叠态）；参考 HTML 为 `output/playwright/launcher-options.html`。
- 未覆盖：折叠态由宿主 `wide` 驱动而非实际测量，若未来 DS-Bot 不再向 footer entry 传 `wide`，入口会按展开态渲染（不会变成空图标）。
```

把 `N tests`、`files = N`、`0 fail` 改成 Step 1/Step 2 的真实数字；实机一行只有在 Step 5 真正完成后才能保留。

- [ ] **Step 7: 提交验收记录**

```bash
cd packages/dsh-workbuddy-expert-plus
git status --short
git add docs/verification-report.md
git commit -m "docs: record the Bot launcher pill verification"
```

Expected: commit 成功，`git status --short` 为空。

---

## 完成后核对清单

- [ ] 展开态：32px 高、999px 圆角、1px DSH 边框、图标 + 文案 + 箭头，文案走 `nav` key。
- [ ] 折叠态：`wide=false` → 36×36、只有星形图标、无文字残留、无箭头。
- [ ] 主题：浅色/深色/第三方主题切换只靠 CSS token，无 JS 监听、无硬编码主题色。
- [ ] 交互：hover 边框加深 + 背景变化；focus-visible 2px 品牌色描边；disabled 降透明度；减少动效时无过渡。
- [ ] 兼容：`wide` 缺省按展开态；老宿主没有 `--dsw-*` 时 rgba fallback 仍可见。
- [ ] 边界：不改 DS-Bot、不写私有 storage、不新增 DOM 注入、不新增依赖、不新增 locale key。
