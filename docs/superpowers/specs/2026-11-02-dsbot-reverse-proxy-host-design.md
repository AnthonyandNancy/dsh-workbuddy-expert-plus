# DS-Bot 在反向代理/服务器部署下的可用性与创建修复设计方案

**日期：** 2026-11-02
**分支：** `fix/dsbot-trusted-proxy-host`
**基线：** `33b6d2c`（`main`，插件 `0.2.1`）
**状态：** 方案已定稿，待实现计划执行
**适用宿主：** DSH Web `0.2.1-rc.4`、DS Bot `0.2.4`；插件自身 `0.2.1`

---

## 1. 结论摘要

用户截图中的「DS-Bot 不可用或版本不兼容，无法创建 Bot」**不是版本不兼容**。

根因由两段相邻缺陷组成：

1. **环境探测的请求目标构造错误（直接触发）**
   `src/adapters/request-fetch.js` 在 DSH Web 经反向代理/公网域名访问时，读到浏览器的 `Host: <public-domain>`，随后要求该 Host 必须是 loopback，直接抛出
   `DS-Bot requests require a loopback Host`，并把异常归一为 `incompatible`。
   客户端 `BotMarketOverlay` 把所有非 `ready/readOnly` 状态统一映射为 `botUnavailable`，于是显示图二的文案。
2. **插件的写路由同样只接受 loopback Host（第二道门）**
   `src/importer/bundled-routes.js` 的 `sameOrigin()` 也把 `Host` 限死为 `127.0.0.1|localhost|[::1]`。
   即使修好探测，创建 `POST /market/bot/create` 仍会 403；同时内部转发若改用公网 Host/`DSH_WEB_URL` 又会把 DS-Bot 协议请求导出到代理域名，存在 SSRF/错误信任面。

因此修复不能只是“放宽正则”。正确边界是：

> **入站路由复用 DSH 已配置的请求信任（loopback、监听绑定地址或 `trustedHosts`），出站 DS-Bot 调用走宿主共享 `/api` handler，并携带入站请求已认证的 owner Peer；全程不产生网络回环目标，也不搬运浏览器 cookie。**

---

## 2. 现象与证据

### 2.1 用户现象

- DSH Web 部署在服务器上，通过反向代理域名访问。
- Bot 市场能打开，但顶部出现：
  `DS-Bot 不可用或版本不兼容，无法创建 Bot`
- 「创建 Bot」按钮被禁用。
- 用户查询后怀疑图一所述 loopback Host 问题。

### 2.2 代码证据（按调用链）

| 层 | 文件/位置 | 事实 |
|---|---|---|
| UI 文案 | `client/client.js:646-647` | `botUnavailable: 'DS-Bot 不可用或版本不兼容，无法创建 Bot'` |
| UI 判定 | `client/client.js:2959` 附近 | 只有 `env.status === 'ready'` 才启用创建；`unknown/incompatible/absent` 全部显示同一 `botUnavailable` |
| Bot 环境路由 | `src/importer/bundled-routes.js:215` | `probe({ fetchImpl: createBotRequestFetch(request) })` |
| 构造 fetch | `src/adapters/request-fetch.js:22-28` | 请求带 `Host` 时，非 loopback 立即抛 `DS-Bot requests require a loopback Host` |
| 错误归一 | `src/adapters/environment.js:21-26` | 该异常带 `code: 'INCOMPATIBLE'`，返回 `{ status: 'incompatible' }` |
| 创建写路由 | `src/importer/bundled-routes.js:31-38` | `sameOrigin()` 同样只接受 loopback Host；公网域名进来的 POST 返回 403 |
| 内部目标 | `src/adapters/request-fetch.js:36-44` | 最终 URL 必须 loopback；`fallbackBase` 只可能是 `DSH_WEB_URL` 或 Host 拼接 |
| 客户端固定文案 | `client/client.js:2959` | `incompatible` 被显示成“版本不兼容”，没有暴露真实原因 |

### 2.3 宿主侧事实（DSH 0.2.1-rc.4）

- `@deepseek-ai/dsh-host-webserver` 的 `WebServer` 提供：
  - `ctx.webServer.host`：配置的**具体**监听 IP 字面量；
  - `ctx.webServer.port`：实际监听端口；
  - `ctx.webServer.protocol`：`http:` 或 `https:`；
  - `ctx.webServer.getOrigin()`：服务端可直接访问的本地 origin，如 `http://127.0.0.1:3080`。
- `@deepseek-ai/dsh-client-connection` 的请求信任模型：
  - 入站 `Host` 允许 loopback、监听绑定 IP 字面量、或显式 `trustedHosts`；
  - 存在 `Origin` 时必须与 `Host` 同 authority；
  - `sec-fetch-site: cross-site` 一律拒绝；
  - cookie 与 **authority（host+port）绑定**，不能把公网域名的 cookie 直接转给 `127.0.0.1`；
  - `trustedHosts` 是部署配置，`--public-url` 只用于展示、**不授予信任**。
- DS-Bot 0.2.4 的 `POST /api/bot` 注册在 `ctx.connection.fetch` 的精确 Fetch 路由上，要求 owner Peer；它不读取业务身份，但整条 `/api` 通道先经 DSH 信任/认证。
- 该精确 Fetch 路由的 handler 目前**没有公开的跨插件“直接调用”服务**；`createSharedFetchHandler` 是 DSH 内部组合方法，不能当作稳定契约依赖。

### 2.4 复现要点

在 DSH Web 前放置反向代理（例如 `https://dsh.example.com` → `http://127.0.0.1:3080`），并让 DSH 启动参数包含
`--public-url https://dsh.example.com --trusted-host dsh.example.com`。
浏览器请求到达插件路由时：

- `request.headers.host === 'dsh.example.com'`（或含端口）；
- `request.headers.origin === 'https://dsh.example.com'`；
- 插件 `createBotRequestFetch()` 在读到 Host 后立刻抛 loopback 错误；
- `/market/environment` 返回 `{ status: 'incompatible', reason: 'DS-Bot requests require a loopback Host' }`；
- 客户端渲染 `botUnavailable`，创建按钮禁用。

---

## 3. 根因定义

**根因 R1：** 环境探测把“浏览器访问 authority”误当成“服务端调用 DS-Bot 的目标 authority”。
服务端到 DS-Bot 的连接目标应是**本进程监听地址**，而不是用户浏览器地址；代码却把两者绑定为同一个 Host 校验。

**根因 R2：** 插件的写路由复制了 loopback-only 的 Host 策略，没有复用 DSH `trustedHosts`/绑定地址/同源检查。
它导致即便探测修好，创建请求仍被 403。

**根因 R3：** 错误分类与提示文案把“信任/目标构造失败”折叠成“版本不兼容”，掩盖了真实原因，增加了误诊成本。

**非根因（已排除）：**

- 插件版本 `0.2.1` 不是旧版本；它是当前仓库 `main` 最新提交。
- DSH 版本在插件 `engines.dsh` 声明范围内。
- DS-Bot `0.2.4` 的 `api/bot` 协议存在且可调用；不是 DS-Bot 版本缺失。
- 不是 `localStorage` 残留导致；该路径只影响 surface 提示，不决定 probe 的 `incompatible`。

---

## 4. 目标与非目标

### 4.1 目标

1. 反向代理/服务器部署下，DS-Bot 环境探测返回真实状态（`ready/readOnly/absent/unknown`），不再因公网 `Host` 误报 `incompatible`。
2. 同一部署下，`POST /market/bot/create` 能通过 DSH 已认可的入站 authority，并只向本进程自己的 DS-Bot 路由发起调用。
3. 不扩大 SSRF 面：绝不把 `Host`、`Origin`、`X-Forwarded-*` 或 `DSH_WEB_URL` 直接拼成出站目标。
4. 不伪造/搬运浏览器 cookie；不绕过 DSH 的 authority 绑定与 Peer 认证。
5. 错误提示能区分“信任配置拒绝”“DS-Bot 缺失”“只读”“网络未知”“真正的协议不兼容”。
6. 以 TDD 覆盖：相对路径正常、代理 authority 正常、恶意/未知 Host 拒绝、进程内桥接目标固定、无凭据泄漏、旧 loopback 回归不破坏。
7. 在真实反向代理形态下完成创建流程复验并留证。

### 4.2 非目标

- 不修改 DSH 或 DS-Bot 上游源码。
- 不承诺支持任意公网 Host；只支持 DSH 明确配置的 `trustedHosts`、绑定地址或 loopback。
- 不把 DS-Bot 内部协议改造成公开 SDK。
- 不处理与本问题无关的 Bot 市场 UI/滚动/入口层级。
- 不新增第三方依赖。

---

## 5. 方案比较

### 方案 A（推荐）：入站委托 DSH `connection.admit()` + 进程内 owner Peer 桥接

**做法：**

1. **入站准入直接委托宿主** `ctx.connection.admit({ headers })`：
   - 该 API 是 DSH 的公开契约，内部已实现 loopback、监听绑定地址、`trustedHosts`、Origin 同源、`sec-fetch-site: cross-site` 拒绝等全部规则；
   - 插件不再复制一套容易漂移的 authority 算法；
   - `undefined` 表示通过，`401/403` 原样作为拒绝结果；
   - `connection` 不可用时返回 `TRUST_UNAVAILABLE`，不静默放行。
2. **出站走进程内 Fetch，而不是本机 HTTP 回环**：
   - 用 `connection.admit({ headers: request.headers })` 取得本次浏览器请求的真实 owner Peer；
   - 用 `connection.createSharedFetchHandler('/api')` 创建与宿主 `/api` 相同的共享 handler；
   - 构造 `new Request('http://dsh.inprocess/api/bot', { method:'POST', headers:{'content-type':'application/json'}, body })`；
   - 调用 `handler.fetch(request, peer)`，直接进入 DS-Bot 的精确 Fetch 路由；
   - 全程不发网络请求、不带 cookie、不受 `Host`/`Origin`/`DSH_WEB_URL` 影响。
3. **兼容性检测**：
   - 若 `connection.createSharedFetchHandler`、`connection.admit` 或 `browserPeer` 任一不可用，返回 `BRIDGE_UNAVAILABLE`，并在 probe 中显示可操作提示；
   - 不回退到“带 cookie 的本机 HTTP”，因为那既破坏 cookie authority 绑定，也可能被 401 拦截。
4. **真正的端口/部署目标仍可观测**：
   - `webServer.getOrigin()` 仅用于诊断与日志，不参与桥接请求 URL；
   - 桥接请求使用固定的内部 origin（`http://dsh.inprocess`），因为 handler 只看 `pathname`。
5. 客户端错误映射：
   - `trustRequired` → 「当前访问地址未被 DSH 信任，请用 `--trusted-host` 配置该域名」
   - `absent` → 「DS-Bot 插件未安装或未加载」
   - `readOnly` → 现有只读文案
   - `unknown` → 「DS-Bot 暂时不可达」
   - `incompatible` 仅在响应结构真的不匹配时出现。

**优点：**

- 根因修复，不靠放开公网 Host；
- 不产生任何用户可控出站目标，SSRF 面为零；
- 不搬运 cookie，完全复用 DSH 已认证 Peer；
- 与宿主 `/api` 走完全相同的路由与 DS-Bot 协议；
- 不依赖未公开的 `createSharedFetchHandler` 之外任何内部表。

**风险/代价：**

- 依赖 `connection.admit()` 与 `connection.createSharedFetchHandler()` 两项公开契约；旧宿主缺任一方法必须安全拒绝并提示升级，不放宽信任；
- `admit` 同时检查 Host/Origin 与浏览器认证：未登录/无浏览器 cookie 的请求会得到 401，这与其 `/api` 行为一致；测试必须覆盖“可信但未认证”和“已认证”两种；
- 桥接请求是 WHATWG `Request`，其 URL 只用于取 `pathname`；必须写测试证明请求头里的公网 Host/Origin 不会进入 handler 的目标；
- DS-Bot handler 若未来读取 `request.headers.cookie`，桥接将没有该头；需在升级时显式传 owner Peer 或调整协议，不能回退为搬运 cookie。

### 方案 B：仅修复 `request-fetch.js`，允许公网 Host 拼接目标

**做法：** 去掉 loopback 检查，直接 `https://${Host}/api/bot` 转发。

**拒绝理由：**

- 直接把用户可控 Host/Origin 变成出站目标，典型 SSRF/开放代理；
- cookie authority 不匹配，认证必失败；
- 无法区分可信代理与恶意域名；
- 不满足“根因修复”与安全门槛。

### 方案 C：要求用户改回 loopback/隧道访问，不改插件

**做法：** 文档要求用户通过 SSH 隧道或本机端口访问。

**拒绝理由：**

- 回避了服务器部署这一明确场景；
- 用户已明确要求解决部署在服务器上的 DSH Web；
- 仍会把“配置问题”误报为“版本不兼容”。

**结论：采用方案 A。**

---

## 6. 详细设计

### 6.1 模块边界

| 模块 | 责任 | 输入 | 输出 |
|---|---|---|---|
| `src/adapters/request-fetch.js`（改造） | 把 DS-Bot 协议调用桥到宿主共享 `/api` handler | `connection`（`admit` / `createSharedFetchHandler`）, `request.headers` | `fetch(input, init)`；固定内部 URL，携带 owner Peer |
| `src/importer/bundled-routes.js`（改造） | 入站委托 `admit`，并注入桥接 fetch | `hostCtx`（webServer/connection/settings） | 结构化 HTTP 错误与 probe 状态 |
| `src/importer/index.js`（改造） | 把宿主 facts 注入路由 | `webServer`, `connection` | `connection`（桥接）、`getOrigin`（仅诊断） |
| `client/client.js`（改造） | 展示真实原因 | `environment` payload | `botTrustRequired` / `botAbsent` / `botUnknown` / `botIncompatible` |

### 6.2 入站准入（委托 DSH）

对每个请求：

1. 取 `hostCtx.connection`；缺失或 `admit` 不可用 → `TRUST_UNAVAILABLE`（不静默放行）。
2. 调用一次 `connection.admit({ headers: request.headers })`：
   - 返回 `{ peer }` → 通过，并保留 peer 供桥接复用；
   - 返回 `{ rejection: 401 }` → 未认证（浏览器 cookie 缺失/过期/authority 不匹配）；
   - 返回 `{ rejection: 403 }` → Host/Origin 不可信或 cross-site。
3. 把拒绝映射为 `TRUST_REQUIRED`；`environment` 的 probe 以 200 返回
   `{ status: 'unknown', code: 'TRUST_REQUIRED', reason }`，写路由返回 403。
4. **不**在插件内复制 loopback/`trustedHosts`/Origin 规则；DSH 的 `admit()` 是该策略的唯一权威。
5. 每条路由**只调用一次** `admit()`；桥接复用返回的 peer，不重复 admission。
6. 若 `admit` 不存在（旧宿主），返回 `TRUST_UNAVAILABLE` 并提示升级 DSH；不退回宽松策略。

### 6.3 进程内桥接算法

`createBotRequestFetch({ connection, request, fetchImpl? })`：

1. 校验 `connection.createSharedFetchHandler` 是函数；否则抛 `BRIDGE_UNAVAILABLE`。
2. 校验 `connection.admit` 是函数；调用 `connection.admit({ headers: request.headers })`：
   - 返回 `{ peer }` → 继续；
   - 返回 `{ rejection }` → 抛 `TRUST_REQUIRED`，带 DSH 的 401/403；
   - 抛异常 → 抛 `TRUST_UNAVAILABLE`。
3. 创建共享 handler：`const handler = connection.createSharedFetchHandler('/api')`。
4. 返回 `async (_input, init = {})`：
   - 构造固定内部 URL：`http://dsh.inprocess/api/bot`；
   - 只允许 `content-type`、`accept` 等协议头；**不复制**入站 `cookie`/`authorization`/`host`/`x-forwarded-*`/`origin`；
   - 构造 `new Request(INTERNAL_API_BOT, { method: init.method ?? 'POST', headers, body: init.body, signal: init.signal })`；
   - 调用 `handler.fetch(req, peer)`；
   - 返回 `Response`；若返回非 Response，抛 `INCOMPATIBLE`。
5. 不调用 `fetchImpl` 做网络请求；参数仅为测试注入保留（若存在，只允许测试断言未被调用）。
6. 错误码区分：`TRUST_REQUIRED`、`TRUST_UNAVAILABLE`、`BRIDGE_UNAVAILABLE`、`INCOMPATIBLE`。

### 6.4 DS-Bot 认证/身份处理

- **唯一路径**：入站 `admit()` 验证 Host/Origin + 浏览器 cookie，并返回该 cookie 对应的 owner Peer；桥接调用 `handler.fetch(request, peer)`。
- 这是 DSH `/api` 自身的调用路径；DS-Bot 精确 Fetch 路由要求 owner Peer，因此能通过。
- 不复制、不转发、不伪造浏览器 cookie；Peer 是进程内对象，不经过网络。
- 若 `admit` 返回 401（cookie 缺失/过期/authority 不匹配）：probe 返回 `TRUST_REQUIRED`，提示重新登录/检查 `--trusted-host`。
- 绝不：使用 `publicUrl`/`DSH_WEB_URL` 做出站目标；伪造 `Host` 头；把公网 cookie 发到 `127.0.0.1`。

### 6.5 路由改造

`mountBundledMarketRoutes(hostCtx, deps)` 增加依赖：

```js
{
  webServer: { host, port, protocol, getOrigin },
  connection: { admit(request), createSharedFetchHandler(channel) },
  fetchImpl?: typeof fetch,
}
```

- `environment` 路由：
  - 先 `connection.admit({ headers: request.headers })`；无 `peer` → 200 + `{ status: 'unknown', code: 'TRUST_REQUIRED', reason }`（不误报 incompatible）。
  - 通过后 `probe({ fetchImpl: createBotRequestFetch({ connection, request }) })`。
- `bot/create` 路由：
  - 保留 `POST` 方法检查和单飞锁；
  - `admit` 无 `peer` → 403 `{ code: 'TRUST_REQUIRED' }`；
  - `botService.create(..., { fetchImpl: createBotRequestFetch({ connection, request }) })`。
- `bot/bindings`：同样用桥接 fetch；失败返回 502 但带 `code`。
- `currentState()` 中 `botService.bindings()` 的静默 catch 保留，但记录 `warn` 一次，避免完全无诊断。

### 6.6 客户端文案

新增 i18n key（中/英）：

| key | 中文 | 英文 |
|---|---|---|
| `botTrustRequired` | 当前访问地址未被 DSH 信任，请用 `--trusted-host` 配置该域名 | This address is not trusted by DSH; configure it with `--trusted-host` |
| `botAbsent` | DS-Bot 插件未安装或未加载 | DS-Bot is not installed or loaded |
| `botUnknown` | DS-Bot 暂时不可达，请稍后重试 | DS-Bot is temporarily unreachable; retry later |
| `botIncompatible` | DS-Bot 响应格式不兼容 | DS-Bot returned an incompatible response |
| `botReadOnly` | 现有文案保留 | existing copy |

映射规则：

- `env.code === 'TRUST_REQUIRED'` → `botTrustRequired`
- `status === 'absent'` → `botAbsent`
- `status === 'unknown'` → `botUnknown`
- `status === 'incompatible'` → `botIncompatible`
- `status === 'readOnly'` → `botReadOnly`

`statusText` 只在非 ready 时显示；`reason` 作为 `title` 或副行显示，便于排障。

### 6.7 错误码契约

| 场景 | HTTP | code | 客户端表现 |
|---|---|---|---|
| Host/Origin 不可信 / 无登录 cookie | 403（写）/ 200 probe | `TRUST_REQUIRED` | 提示配置 `--trusted-host` / 重新登录 |
| 宿主缺少桥接方法 | 503（写）/ 200 probe | `BRIDGE_UNAVAILABLE` | 提示升级 DSH |
| DS-Bot 路由 404 | — | `ABSENT` | `botAbsent` |
| 401/403 | — | `READ_ONLY` | `botReadOnly` |
| 5xx/超时/网络 | — | `UNKNOWN` | `botUnknown` |
| JSON/`ok` 结构不符 | — | `INCOMPATIBLE` | `botIncompatible` |

### 6.8 测试设计

**单元：`request-admission.test.js`（新）**

- `admit` 返回 `{ peer }` → 通过；
- 返回 `{ rejection: 401/403 }` → 映射为 `TRUST_REQUIRED`，且不调用 probe；
- `connection` 缺失或 `admit` 不存在 → `TRUST_UNAVAILABLE`；
- 传参必须是 `{ headers: request.headers }`；每条路由只调用一次 `admit`。

**单元：`request-fetch.test.js`（改造）**

- 桥接目标是固定内部 `http://dsh.inprocess/api/bot`；
- 入参 URL 被忽略，不能改变目标；
- 不转发 cookie/authorization/host/x-forwarded-*；
- `admit` 返回 `{ rejection: 401/403 }` → 抛 `TRUST_REQUIRED`；
- `createSharedFetchHandler`/`admit` 缺失 → 抛 `BRIDGE_UNAVAILABLE`；
- 代理环境（Host=`dsh.example.com`）下仍使用固定内部 URL；
- 原 `isLoopbackAuthority` 导出删除，相关测试改为 `isLoopbackHostname`（仅用于诊断/防御）。

**集成：`bundled-routes.test.js`**

- 公网 Host + 已配置 trustedHost → `/market/environment` 返回 `ready`（mock probe 或 mock fetch）；
- 公网 Host 未配置 → 返回 `TRUST_REQUIRED`，不是 `incompatible`；
- `/market/bot/create` 在 trustedHost 下成功；
- 未信任 Host 的 POST 返回 403 且不调用 `create-bot`；
- 出站 fetch 收到固定本机 URL，且 headers 无 cookie。

**客户端：`client-bot-ui.test.js` / `client-dual-mode.test.js`**

- `TRUST_REQUIRED` 显示 `botTrustRequired`；
- `absent/unknown/incompatible` 各自文案；
- ready 显示创建按钮。

**回归：**

- 现有 loopback 测试全部保留；
- `npm test` 全量通过（目标 ≥ 现有 102 tests + 新增）。

### 6.9 验收标准

- [ ] 反向代理形态下 probe 不再报 `incompatible`；`trustedHost` 配置正确时返回 `ready`。
- [ ] 创建流程在真实 DSH Web + DS-Bot 0.2.4 + 反向代理下成功，且 Bot 出现在 DS-Bot 状态中。
- [ ] 未信任公网 Host 被 403/`TRUST_REQUIRED` 拒绝，且没有出站请求。
- [ ] 任何入站请求头都不能改变桥接调用的固定内部路径或 Peer。
- [ ] 桥接请求不含浏览器 cookie/authorization。
- [ ] 中文/英文文案不再把信任问题说成版本不兼容。
- [ ] `node --test test/*.test.js`、`npm test`、`npm run check:package` 全绿。
- [ ] 独立代码复核无 P0/P1 问题。

### 6.10 回滚策略

- 分支级回滚：`git revert` 本分支提交即可恢复旧行为。
- 配置回退：移除 `--trusted-host` 后，公网访问应回到明确的 `TRUST_REQUIRED` 提示（而非旧 `incompatible`）。
- 若宿主版本差异导致 `connection.admit` 不可用：返回 `TRUST_UNAVAILABLE` 并提示升级/配置，不静默放开。

---

## 7. 风险与缓解

| 风险 | 影响 | 缓解 |
|---|---|---|
| 旧宿主无 `connection.admit` | 代理域名无法判定 | 返回 `TRUST_UNAVAILABLE`，不降级为宽松 trust；文档给出升级要求 |
| 宿主桥接 API 缺失/版本差异 | 创建失败 | 返回 `BRIDGE_UNAVAILABLE` 并提示升级；不回退为本机 HTTP 或搬运 cookie |
| `admit()` 未返回 owner Peer | 精确 Fetch 路由 403 | probe 显示 `TRUST_REQUIRED`；测试覆盖 401/403 与正常 owner Peer |
| 宿主 trust 行为随版本变化 | 安全边界不一致 | 不自实现 trust；直接委托 `admit`；测试固定调用契约与失败映射 |
| 代理剥离 Origin | 误放行 | 由 DSH `admit` 统一裁决；插件不另写规则 |
| 宿主桥接 handler 在监听前不可用 | 早期请求失败 | 路由 handler 内惰性创建；失败返回 503 `BRIDGE_UNAVAILABLE`，不缓存坏值 |
| 出站错误被误标 incompatible | 误诊 | 错误码映射表 + 客户端分支文案 + 测试 |

---

## 8. 交付物

1. 本方案文档（本文件）。
2. `docs/superpowers/plans/2026-11-02-dsbot-reverse-proxy-host.md` 任务计划书。
3. 代码与测试改动。
4. `docs/verification-report.md` 新增本轮根因、证据、命令结果与真实代理验收。
5. 复现/验收脚本或记录（如 `output/playwright/` 或 `.tmp-review/` 下的代理日志）。

---

## 9. 决策记录

- **采用方案 A**，拒绝方案 B/C。
- **出站唯一路径**：`connection.createSharedFetchHandler('/api')` + `connection.admit()` 的 owner Peer；不使用网络回环，请求头不参与目标。
- **入站信任唯一来源**：DSH 的 `connection.admit()`（loopback/绑定地址/`trustedHosts`/Origin + 浏览器认证）；不接受任意公网 Host。
- **不搬运 cookie**：Peer 是进程内对象；绝不把公网 cookie 发到 `127.0.0.1` 或伪造 Host。
- **错误语义优先于“看起来能点”**：宁可明确提示 `TRUST_REQUIRED`/`BRIDGE_UNAVAILABLE`，不再把信任失败伪装成版本不兼容。
