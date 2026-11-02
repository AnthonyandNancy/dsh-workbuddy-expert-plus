# DS-Bot 反向代理 Host 可用性修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 DSH Web 经反向代理/公网域名访问时，DS-Bot 环境探测与 Bot 创建不再因 loopback Host 误报“版本不兼容”，同时不扩大出站/信任面。

**Architecture:** 入站准入直接委托 DSH `connection.requestRejection()`；出站 DS-Bot 调用目标唯一固定为 `webServer.getOrigin()`，不再读取请求 `Host`/`DSH_WEB_URL`，也不转发浏览器凭据。路由把真实失败码（`TRUST_REQUIRED`、`ABSENT`、`READ_ONLY`、`UNKNOWN`、`INCOMPATIBLE`）透出，客户端按码显示可操作文案。

**Tech Stack:** Node.js >= 20 ESM、`node:test`、Cordis/DSH `webServer` + `connection` 服务、原生 Fetch、DS-Bot `POST api/bot`、Playwright（真实 DSH Web + 反向代理验收）。

## Global Constraints

- 仓库根是 `D:\code\ai\dsh-workbuddy-expert\packages\dsh-workbuddy-expert-plus`；所有 `git` 命令在该目录运行。
- 当前分支必须是 `fix/dsbot-trusted-proxy-host`，基线 `33b6d2c`。
- 目标宿主：DSH `0.2.1-rc.4`、DS Bot `0.2.4`；插件自身 `0.2.1`。
- 不修改 DSH、DS-Bot 上游源码；不新增第三方依赖。
- 入站信任唯一来源：`ctx.connection.requestRejection({ headers })`；禁止在插件内另写 loopback/`trustedHosts`/Origin 规则。
- 出站目标唯一来源：`ctx.webServer.getOrigin()`；禁止用请求 `Host`、`Origin`、`X-Forwarded-*`、`DSH_WEB_URL`、`publicUrl` 拼接出站 URL。
- 出站请求不得携带 `cookie`、`authorization`、`host`、`x-forwarded-*`、`origin`。
- 不写浏览器 `localStorage['ds-bot:*']`，不注入宿主 DOM。
- 所有代码改动必须先有失败测试（RED），再实现（GREEN），每个任务独立提交。
- 每个任务结束时运行该任务的定向测试；全量验证在 Task 5。
- 中文用户文案优先；英文同步补齐。
- 真实代理验收必须记录代理配置、请求/响应证据与截图/日志路径。

---

## File Structure

| 文件 | 责任 | 创建/修改 |
|---|---|---|
| `src/adapters/request-fetch.js` | 固定目标构造、凭据剥离、目标合法性 | 修改 |
| `test/request-fetch.test.js` | 固定目标/凭据/恶意输入单元测试 | 修改 |
| `src/importer/bundled-routes.js` | 入站 `requestRejection`、错误码、固定目标注入 | 修改 |
| `test/bundled-routes.test.js` | 代理 Host 探测/创建/403/无出站集成测试 | 修改 |
| `src/importer/index.js` | 从宿主注入 `webServer`/`connection` 依赖 | 修改 |
| `test/plugin-lifecycle.test.js` | 注入契约与缺服务降级测试 | 修改 |
| `client/client.js` | 新增错误文案与状态映射 | 修改 |
| `test/client-bot-ui.test.js` | 文案映射与按钮禁用测试 | 修改 |
| `docs/verification-report.md` | 根因、命令、真实代理验收证据 | 修改 |
| `docs/superpowers/specs/2026-11-02-dsbot-reverse-proxy-host-design.md` | 方案（已存在） | 已创建 |
| `docs/superpowers/plans/2026-11-02-dsbot-reverse-proxy-host.md` | 本计划 | 已创建 |

---

### Task 1: 用宿主共享 `/api` handler 桥接 DS-Bot 请求

**Files:**
- Modify: `src/adapters/request-fetch.js`（整文件替换）
- Test: `test/request-fetch.test.js`（整文件替换）

**Interfaces:**
- Consumes:
  - `connection.createSharedFetchHandler(channel): { fetch(request: Request, peer): Promise<Response> }`
  - `connection.admit(request): { peer } | { rejection: 401|403|409 }`
  - 入站 `request.headers`
- Produces:
  - `createBotRequestFetch({ connection, request, fetchImpl? }): (input, init) => Promise<Response>`
  - 固定内部 URL `http://dsh.inprocess/api/bot`；
  - `admit` 拒绝时抛 `{ code: 'TRUST_REQUIRED' }`；
  - 缺 `admit`/`createSharedFetchHandler` 时抛 `{ code: 'BRIDGE_UNAVAILABLE' }`；
  - handler 返回非 `Response` 时抛 `{ code: 'INCOMPATIBLE' }`。

- [ ] **Step 1: 写失败测试**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

const { createBotRequestFetch } = await import('../src/adapters/request-fetch.js')

function bridgeHarness({ rejection } = {}) {
  const calls = []
  const peer = { id: 'peer-owner' }
  const connection = {
    admit(request) {
      calls.push({ kind: 'admit', headers: request.headers })
      return rejection === undefined ? { peer } : { rejection }
    },
    createSharedFetchHandler(channel) {
      calls.push({ kind: 'handler', channel })
      return {
        async fetch(request, admittedPeer) {
          calls.push({ kind: 'fetch', url: request.url, method: request.method, headers: Object.fromEntries(request.headers), peer: admittedPeer })
          return new Response(JSON.stringify({ ok: true, value: { bots: [], models: [] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      }
    },
  }
  return { connection, calls, peer }
}

test('the bridge sends a fixed in-process URL and the admitted owner peer', async () => {
  const harness = bridgeHarness()
  const fetch = createBotRequestFetch({
    connection: harness.connection,
    request: { headers: { host: 'dsh.example.com', cookie: 'session=abc', origin: 'https://dsh.example.com' } },
  })
  const response = await fetch('https://attacker.example/api/bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'session=abc', authorization: 'Bearer x', host: 'attacker.example' },
    body: '{"endpoint":"state"}',
  })
  assert.equal(response.status, 200)
  assert.deepEqual(harness.calls.filter((call) => call.kind === 'handler'), [{ kind: 'handler', channel: '/api' }])
  assert.deepEqual(harness.calls.filter((call) => call.kind === 'admit'), [{ kind: 'admit', headers: { host: 'dsh.example.com', cookie: 'session=abc', origin: 'https://dsh.example.com' } }])
  const bridged = harness.calls.find((call) => call.kind === 'fetch')
  assert.equal(bridged.url, 'http://dsh.inprocess/api/bot')
  assert.equal(bridged.method, 'POST')
  assert.equal(bridged.headers.cookie, undefined)
  assert.equal(bridged.headers.authorization, undefined)
  assert.equal(bridged.headers.host, undefined)
  assert.equal(bridged.headers['content-type'], 'application/json')
  assert.equal(bridged.peer, harness.peer)
})

test('a rejected admission never reaches the handler', async () => {
  const harness = bridgeHarness({ rejection: 403 })
  const fetch = createBotRequestFetch({ connection: harness.connection, request: { headers: { host: 'evil.example' } } })
  await assert.rejects(() => fetch('api/bot', { method: 'POST', body: '{}' }), (error) => error.code === 'TRUST_REQUIRED')
  assert.equal(harness.calls.some((call) => call.kind === 'fetch'), false)
})

test('missing bridge APIs fail closed', async () => {
  await assert.rejects(
    () => Promise.resolve(createBotRequestFetch({ connection: {}, request: { headers: {} } })),
    (error) => error.code === 'BRIDGE_UNAVAILABLE',
  )
  await assert.rejects(
    () => Promise.resolve(createBotRequestFetch({ connection: { admit() { return { peer: {} } } }, request: { headers: {} } })),
    (error) => error.code === 'BRIDGE_UNAVAILABLE',
  )
})

test('a non-Response handler result is incompatible, not a success', async () => {
  const harness = bridgeHarness()
  harness.connection.createSharedFetchHandler = () => ({ async fetch() { return { status: 200 } } })
  const fetch = createBotRequestFetch({ connection: harness.connection, request: { headers: {} } })
  await assert.rejects(() => fetch('api/bot', { method: 'POST', body: '{}' }), (error) => error.code === 'INCOMPATIBLE')
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run:
```bash
node --test test/request-fetch.test.js
```
Expected: FAIL，旧实现仍读取 `request.headers.host`/转发 cookie，或 `createSharedFetchHandler` 未被调用。

- [ ] **Step 3: 实现进程内桥接**

```js
/**
 * Build the ONE host-side fetch used for DS-Bot's POST api/bot route.
 *
 * The request is dispatched through DSH's own shared /api Fetch handler with
 * the Peer admitted from the incoming browser request. Nothing is sent over
 * the network: the internal URL only supplies the pathname the handler reads,
 * and browser credentials never leave their own authority.
 */

const INTERNAL_API_BOT = 'http://dsh.inprocess/api/bot'
const ALLOWED_INIT_HEADERS = new Set(['content-type', 'accept'])

function bridgeError(code, message) {
  return Object.assign(new Error(message), { code })
}

export function createBotRequestFetch({ connection, request, fetchImpl = globalThis.fetch } = {}) {
  if (typeof connection?.createSharedFetchHandler !== 'function' || typeof connection?.admit !== 'function') {
    throw bridgeError('BRIDGE_UNAVAILABLE', 'DSH connection cannot bridge api/bot in-process; upgrade DSH Web')
  }
  const admission = connection.admit({ headers: request?.headers ?? {} })
  if (admission === null || typeof admission !== 'object' || !('peer' in admission)) {
    const rejection = admission?.rejection
    throw bridgeError('TRUST_REQUIRED', `DSH rejected the request (${String(rejection ?? 'no peer')})`)
  }
  const handler = connection.createSharedFetchHandler('/api')
  if (handler === null || typeof handler?.fetch !== 'function') {
    throw bridgeError('BRIDGE_UNAVAILABLE', 'DSH shared /api handler is unavailable')
  }
  return async (_input, init = {}) => {
    const headers = {}
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      if (typeof value !== 'string') continue
      if (ALLOWED_INIT_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value
    }
    const bridged = new Request(INTERNAL_API_BOT, {
      method: init.method ?? 'POST',
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    })
    const response = await handler.fetch(bridged, admission.peer)
    if (!(response instanceof Response)) {
      throw bridgeError('INCOMPATIBLE', 'DSH shared /api handler did not return a Response')
    }
    return response
  }
}
```

> `fetchImpl` 仅为测试/未来注入保留；当前实现不得调用它，测试可断言它未被调用。`Request`/`Response` 来自 Node 20+ 全局。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:
```bash
node --test test/request-fetch.test.js
```
Expected: PASS，4 tests，0 failed。

- [ ] **Step 5: 提交**

```bash
git add src/adapters/request-fetch.js test/request-fetch.test.js
git commit -m "fix: bridge DS-Bot requests through DSH's in-process api handler"
```

---

### Task 2: 路由入站委托 DSH `requestRejection` 并使用桥接 fetch

**Files:**
- Modify: `src/importer/bundled-routes.js:1-90`（删除本地 `sameOrigin`，新增 `requestTrust`，替换 3 处 `createBotRequestFetch`）
- Test: `test/bundled-routes.test.js`（新增 4 个测试）

**Interfaces:**
- Consumes:
  - `hostCtx.connection.requestRejection({ headers }): 401 | 403 | undefined`
  - `hostCtx.connection.admit({ headers }): { peer } | { rejection }`
  - `hostCtx.connection.createSharedFetchHandler('/api')`
- Produces:
  - `mountBundledMarketRoutes(hostCtx, { catalog, installer, botService, probe, botEnabled })`
  - `hostCtx` 形状：`{ webServer, connection }`
  - `requestTrust(hostCtx, request)` 返回 `{ ok: true }` 或 `{ ok: false, code, reason }`。

- [ ] **Step 1: 写失败测试**

在 `test/bundled-routes.test.js` 末尾追加（直接使用以下测试）：

```js
function fakeBridgeConnection({ rejection } = {}) {
  const calls = []
  const peer = { id: 'peer-owner' }
  const connection = {
    requestRejection(request) {
      calls.push({ kind: 'trust', headers: request.headers })
      return rejection
    },
    admit(request) {
      calls.push({ kind: 'admit', headers: request.headers })
      return rejection === undefined ? { peer } : { rejection }
    },
    createSharedFetchHandler(channel) {
      calls.push({ kind: 'handler', channel })
      return {
        async fetch(request, admittedPeer) {
          calls.push({ kind: 'fetch', url: request.url, headers: Object.fromEntries(request.headers), peer: admittedPeer })
          return Response.json({ ok: true, value: { bots: [], models: [], readOnly: false } })
        },
      }
    },
  }
  return { connection, calls, peer }
}

test('a trusted proxied Host reaches the DS-Bot probe through the in-process bridge', async () => {
  const server = fakeServer()
  const { connection, calls } = fakeBridgeConnection()
  const probe = async ({ fetchImpl }) => {
    const response = await fetchImpl('api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"endpoint":"state"}' })
    const value = await response.json()
    return value.ok ? { status: 'ready', state: value.value } : { status: 'incompatible' }
  }
  mountBundledMarketRoutes({ webServer: { getOrigin: () => 'http://127.0.0.1:3080' }, connection }, { catalog, probe })
  const response = res()
  await server.routes.get('exact /dsh-workbuddy-expert-plus/api/market/environment').handler(
    req({ headers: { host: 'dsh.example.com', origin: 'https://dsh.example.com', cookie: 'session=abc' } }),
    response,
  )
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'ready')
  assert.deepEqual(calls.find((call) => call.kind === 'trust'), {
    kind: 'trust',
    headers: { host: 'dsh.example.com', origin: 'https://dsh.example.com', cookie: 'session=abc' },
  })
  const bridged = calls.find((call) => call.kind === 'fetch')
  assert.equal(bridged.url, 'http://dsh.inprocess/api/bot')
  assert.equal(bridged.headers.cookie, undefined)
  assert.equal(bridged.peer.id, 'peer-owner')
})

test('an untrusted proxied Host is reported as TRUST_REQUIRED, not incompatible', async () => {
  const server = fakeServer()
  const { connection, calls } = fakeBridgeConnection({ rejection: 403 })
  mountBundledMarketRoutes({ webServer: { getOrigin: () => 'http://127.0.0.1:3080' }, connection }, {
    catalog,
    probe: async () => { throw new Error('probe must not run for an untrusted request') },
  })
  const response = res()
  await server.routes.get('exact /dsh-workbuddy-expert-plus/api/market/environment').handler(
    req({ headers: { host: 'evil.example' } }),
    response,
  )
  assert.equal(response.status, 200)
  assert.equal(response.body.status, 'unknown')
  assert.equal(response.body.code, 'TRUST_REQUIRED')
  assert.equal(calls.some((call) => call.kind === 'fetch'), false)
})

test('an untrusted create POST is refused before create-bot', async () => {
  const server = fakeServer()
  const { connection, calls } = fakeBridgeConnection({ rejection: 403 })
  const botCalls = []
  const botService = { async create() { botCalls.push('create'); throw new Error('must not run') }, async bindings() { return {} } }
  mountBundledMarketRoutes({ webServer: { getOrigin: () => 'http://127.0.0.1:3080' }, connection }, { catalog, botService })
  const response = res()
  await server.routes.get('exact /dsh-workbuddy-expert-plus/api/market/bot/create').handler(
    req({ method: 'POST', headers: { host: 'evil.example' }, body: { expertId: 'x' } }),
    response,
  )
  assert.equal(response.status, 403)
  assert.equal(response.body.code, 'TRUST_REQUIRED')
  assert.deepEqual(botCalls, [])
  assert.equal(calls.some((call) => call.kind === 'fetch'), false)
})

test('a missing connection service fails closed', async () => {
  const server = fakeServer()
  mountBundledMarketRoutes({ webServer: { getOrigin: () => 'http://127.0.0.1:3080' } }, {
    catalog,
    probe: async () => { throw new Error('probe must not run without trust') },
  })
  const response = res()
  await server.routes.get('exact /dsh-workbuddy-expert-plus/api/market/environment').handler(req({ headers: { host: 'dsh.example.com' } }), response)
  assert.equal(response.status, 200)
  assert.equal(response.body.code, 'TRUST_UNAVAILABLE')
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run:
```bash
node --test --test-name-pattern="trusted proxied Host|untrusted proxied Host|untrusted create POST|missing connection" test/bundled-routes.test.js
```
Expected: FAIL，`connection.requestRejection` 未被调用，或仍因 `same-origin required`/`loopback Host` 报错。

- [ ] **Step 3: 实现 trust 与桥接注入**

在 `src/importer/bundled-routes.js` 顶部删除 `sameOrigin()`，新增：

```js
/**
 * Delegate the browser-trust fence to DSH's Connection service. It is the
 * single authority for loopback, listener-bind, `trustedHosts`, Origin and
 * Sec-Fetch-Site policy, and it also enforces the browser/API credential.
 *
 * @returns {{ ok: true } | { ok: false, code: 'TRUST_REQUIRED'|'TRUST_UNAVAILABLE'|'BRIDGE_UNAVAILABLE', reason: string }}
 */
function requestTrust(ctx, request) {
  const reject = ctx?.connection?.requestRejection
  if (typeof reject !== 'function') {
    return { ok: false, code: 'TRUST_UNAVAILABLE', reason: 'DSH connection.requestRejection is unavailable; upgrade DSH Web' }
  }
  try {
    const rejection = reject({ headers: request?.headers ?? {} })
    if (rejection === undefined) return { ok: true }
    if (rejection === 401) return { ok: false, code: 'TRUST_REQUIRED', reason: 'the DSH browser session is missing, expired, or bound to another authority' }
    if (rejection === 403) return { ok: false, code: 'TRUST_REQUIRED', reason: 'this authority is not loopback, the listener bind address, or a configured trustedHosts entry' }
    return { ok: false, code: 'TRUST_REQUIRED', reason: `DSH rejected the request (${String(rejection)})` }
  } catch (error) {
    return { ok: false, code: 'TRUST_UNAVAILABLE', reason: error instanceof Error ? error.message : String(error) }
  }
}

/** Build the in-process fetch for one already-trusted request. */
function botFetchFor(ctx, request) {
  return createBotRequestFetch({ connection: ctx?.connection, request })
}
```

把 `guard()` 改为：

```js
  function guard(request, response) {
    if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return false }
    const trust = requestTrust(hostCtx, request)
    if (!trust.ok) {
      sendJson(response, trust.code === 'TRUST_REQUIRED' ? 403 : 503, { error: trust.reason, code: trust.code })
      return false
    }
    if (mutating) { sendJson(response, 409, { error: 'another change is in progress', code: 'BUSY' }); return false }
    mutating = true
    return true
  }
```

把 `environment` handler 改为：

```js
      if (!botEnabled) return sendJson(response, 200, { status: 'absent', reason: 'Bot integration is disabled' })
      const trust = requestTrust(hostCtx, request)
      if (!trust.ok) return sendJson(response, 200, { status: 'unknown', code: trust.code, reason: trust.reason })
      try {
        sendJson(response, 200, await probe({ fetchImpl: botFetchFor(hostCtx, request) }))
      } catch (error) {
        sendJson(response, 200, { status: 'unknown', code: error?.code ?? 'UNKNOWN', reason: error instanceof Error ? error.message : String(error) })
      }
```

把 `bot/create` 与 `bot/bindings` 的 `createBotRequestFetch(request)` 替换为 `botFetchFor(hostCtx, request)`：

```js
}, { fetchImpl: botFetchFor(hostCtx, request) })
```

和：

```js
sendJson(response, 200, { bindings: await botService.bindings({ fetchImpl: botFetchFor(hostCtx, request) }) })
```

> 注意：`botFetchFor` 内部仍会调用 `connection.admit()`；路由层 `requestTrust()` 先做一次 `requestRejection()`，两者是不同 API，不能互相替代。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:
```bash
node --test test/bundled-routes.test.js
```
Expected: PASS，现有测试 + 新增 4 tests，0 failed。

- [ ] **Step 5: 提交**

```bash
git add src/importer/bundled-routes.js test/bundled-routes.test.js
git commit -m "fix: trust proxied Bot routes through DSH connection"
```

---

### Task 3: 从插件入口注入 `connection` 并透传到路由

**Files:**
- Modify: `src/index.js:197-215`（`ctx.inject(['webServer', 'settings'], ...)` 增加 `connection`）
- Modify: `src/importer/index.js:26-60`（新增 `importerServicesOf` 并传给 `mountBundledMarketRoutes`）
- Test: `test/plugin-lifecycle.test.js`（新增纯函数 + 源码契约测试）

**Interfaces:**
- Consumes: Cordis 服务名 `webServer`、`connection`、`settings`。
- Produces:
  - `importerServicesOf(ctx): { webServer: object, connection: object }`
  - `mountImporter(ctx, { ..., webServer, connection })`
  - `mountBundledMarketRoutes({ webServer, connection }, deps)`

- [ ] **Step 1: 写失败测试**

在 `test/plugin-lifecycle.test.js` 末尾追加：

```js
test('the importer forwards the host webServer and connection services', async () => {
  const { importerServicesOf } = await import('../src/importer/index.js')
  const webServer = { getOrigin: () => 'http://127.0.0.1:3080' }
  const connection = { requestRejection: () => undefined, admit: () => ({ peer: {} }), createSharedFetchHandler: () => ({}) }
  const ctx = { get: (name) => ({ webServer, connection })[name] }
  const services = importerServicesOf(ctx)
  assert.equal(services.webServer, webServer)
  assert.equal(services.connection, connection)
  assert.match(source, /ctx\.inject\(\['webServer', 'settings', 'connection'\]/,
    'the importer segment must wait for the connection service')
})
```

> `source` 是文件顶部已读取的 `client/client.js`；该测试还要读取 `src/index.js`，在同一测试内用
> `const hostSource = readFileSync(join(root, 'src', 'index.js'), 'utf8')`，并把断言改成 `hostSource`。

- [ ] **Step 2: 运行测试确认 RED**

Run:
```bash
node --test --test-name-pattern="forwards the host webServer and connection" test/plugin-lifecycle.test.js
```
Expected: FAIL，`importerServicesOf` 未导出，或源码仍是 `['webServer', 'settings']`。

- [ ] **Step 3: 实现透传**

`src/importer/index.js` 顶部新增：

```js
/** Read the two host services the Bot trust fence and in-process bridge need. */
export function importerServicesOf(ctx) {
  return {
    webServer: ctx.get('webServer'),
    connection: ctx.get('connection'),
  }
}
```

把 `mountBundledMarketRoutes(ctx, { catalog, installer, botService })` 改为：

```js
  const offBundledRoutes = mountBundledMarketRoutes(importerServicesOf(ctx), { catalog, installer, botService })
```

`src/index.js`：

```js
  ctx.inject(['webServer', 'settings', 'connection'], (importerCtx) => {
```

其余 `mountImporter` 调用保持不变；`importerCtx` 自身已带 `webServer`/`connection`，由 `importerServicesOf(ctx)` 读取。

- [ ] **Step 4: 运行测试确认 GREEN**

Run:
```bash
node --test test/plugin-lifecycle.test.js test/bundled-routes.test.js
```
Expected: PASS，所有 lifecycle + bundled route tests 通过。

- [ ] **Step 5: 提交**

```bash
git add src/index.js src/importer/index.js test/plugin-lifecycle.test.js
git commit -m "fix: inject DSH connection into the importer"
```

---

### Task 4: 客户端按真实失败码显示可操作文案

**Files:**
- Modify: `client/client.js:646-651`（中文文案）、`client/client.js:773-778`（英文文案）
- Modify: `client/client.js:2962`（状态映射）、`client/client.js:3638` 附近（导出纯函数）
- Test: `test/client-bot-ui.test.js`（新增 1 个纯函数测试，覆盖 6 个分支）

**Interfaces:**
- Consumes: `/market/environment` 返回 `{ status, code?, reason? }`。
- Produces:
  - `botEnvironmentText(env, t): string`
  - `code` 优先于 `status`；`ready` 返回空串。

- [ ] **Step 1: 写失败测试**

在 `test/client-bot-ui.test.js` 末尾追加：

```js
test('the Bot banner names each environment failure precisely', async () => {
  const vm = await import('node:vm')
  let definition
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (value) => { definition = value } },
      localStorage: { getItem: () => null },
      addEventListener() {},
      removeEventListener() {},
    },
    document: {
      createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
      querySelector: () => null,
      head: { appendChild() {} },
    },
    console, setTimeout, clearTimeout,
    React: { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }) },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const module = definition.factory(() => sandbox.React)
  const t = (key) => ({
    botTrustRequired: 'TRUST',
    botAbsent: 'ABSENT',
    botUnknown: 'UNKNOWN',
    botIncompatible: 'INCOMPATIBLE',
    botReadOnly: 'READONLY',
  })[key] || key

  assert.equal(module.botEnvironmentText({ status: 'unknown', code: 'TRUST_REQUIRED' }, t), 'TRUST')
  assert.equal(module.botEnvironmentText({ status: 'unknown', code: 'TRUST_UNAVAILABLE' }, t), 'TRUST')
  assert.equal(module.botEnvironmentText({ status: 'absent' }, t), 'ABSENT')
  assert.equal(module.botEnvironmentText({ status: 'unknown' }, t), 'UNKNOWN')
  assert.equal(module.botEnvironmentText({ status: 'incompatible' }, t), 'INCOMPATIBLE')
  assert.equal(module.botEnvironmentText({ status: 'readOnly' }, t), 'READONLY')
  assert.equal(module.botEnvironmentText({ status: 'ready' }, t), '')
})
```

- [ ] **Step 2: 运行测试确认 RED**

Run:
```bash
node --test --test-name-pattern="names each environment failure" test/client-bot-ui.test.js
```
Expected: FAIL，`module.botEnvironmentText is not a function`。

- [ ] **Step 3: 新增文案**

中文（`client/client.js` 现有 `botUnavailable` 附近）：

```js
    botTrustRequired: '当前访问地址未被 DSH 信任，请用 --trusted-host 配置该域名',
    botUnavailable: 'DS-Bot 不可用或版本不兼容，无法创建 Bot',
    botAbsent: 'DS-Bot 未安装或未加载，无法创建 Bot',
    botUnknown: 'DS-Bot 暂时不可达，请稍后重试',
    botIncompatible: 'DS-Bot 响应格式不兼容，无法创建 Bot',
```

英文：

```js
    botTrustRequired: 'This address is not trusted by DSH; configure it with --trusted-host',
    botUnavailable: 'DS-Bot is unavailable or incompatible; Bot creation is disabled',
    botAbsent: 'DS-Bot is not installed or loaded; Bot creation is disabled',
    botUnknown: 'DS-Bot is temporarily unreachable; retry later',
    botIncompatible: 'DS-Bot returned an incompatible response; Bot creation is disabled',
```

- [ ] **Step 4: 新增纯函数并接入**

在 `BotMarketOverlay` 之前新增：

```js
/**
 * The exact banner text for one environment probe. The code wins over the
 * status because TRUST_REQUIRED is a deployment/configuration answer, not
 * proof of a DS-Bot protocol mismatch.
 */
function botEnvironmentText (env, t) {
  if (env === null || typeof env !== 'object') return t('botUnknown')
  if (env.status === 'ready') return ''
  if (env.code === 'TRUST_REQUIRED' || env.code === 'TRUST_UNAVAILABLE') return t('botTrustRequired')
  if (env.code === 'BRIDGE_UNAVAILABLE') return t('botBridgeUnavailable')
  if (env.status === 'readOnly') return t('botReadOnly')
  if (env.status === 'absent') return t('botAbsent')
  if (env.status === 'incompatible') return t('botIncompatible')
  return t('botUnknown')
}
```

在 `BotMarketOverlay` 中把：

```js
var statusText = ready ? '' : env.status === 'readOnly' ? t('botReadOnly') : t('botUnavailable')
```

改为：

```js
var statusText = botEnvironmentText(env, t)
```

在 `module.exports` 附近新增：

```js
module.exports.botEnvironmentText = botEnvironmentText
```

同时补 `botBridgeUnavailable` 中英文文案：

```js
botBridgeUnavailable: '当前 DSH 版本无法在进程内连接 DS-Bot，请升级 DSH Web',
```

```js
botBridgeUnavailable: 'This DSH version cannot reach DS-Bot in-process; upgrade DSH Web',
```

- [ ] **Step 5: 更新现有源码契约测试**

`test/client-bot-ui.test.js` 的 `read-only and unknown environments expose no create action` 目前断言
`status === 'ready'`/`disabled` 等源码片段；保留该测试，不要删除。新增的纯函数测试覆盖文案分支。

- [ ] **Step 6: 运行测试确认 GREEN**

Run:
```bash
node --test test/client-bot-ui.test.js
```
Expected: PASS，现有 Bot UI tests + 新增 1 test，0 failed。

- [ ] **Step 7: 提交**

```bash
git add client/client.js test/client-bot-ui.test.js
git commit -m "fix: name the real DS-Bot environment failure in the Bot dialog"
```

---

### Task 5: 全量验证、真实反向代理验收与文档

**Files:**
- Modify: `docs/verification-report.md`（追加本轮章节）
- Create: `output/playwright/dsbot-proxy-host-fixed.png`（真实代理窗口截图）
- Create: `output/playwright/dsbot-proxy-host-create-fixed.png`（创建成功截图）
- Optional: `.tmp-review/proxy/README.md`（代理启动命令与日志）

**Interfaces:**
- Consumes: Tasks 1-4 的实现。
- Produces: 可复核的自动化 + 真实代理证据。

- [ ] **Step 1: 运行定向测试**

```bash
node --test test/request-fetch.test.js test/bundled-routes.test.js test/plugin-lifecycle.test.js test/client-bot-ui.test.js
```
Expected: PASS，0 failed。

- [ ] **Step 2: 运行全量测试**

```bash
node --test test/*.test.js
npm test
npm run check:package
```
Expected:
- `node --test`：全部 PASS，0 failed；
- `npm test`：全部 tests + 4 smoke scripts 通过；
- `check:package`：通过，文件计数与资源计数输出正常。

- [ ] **Step 3: 启动真实反向代理形态**

在 `.tmp-review/proxy/` 创建最小反向代理（不新增项目依赖）：

```js
// .tmp-review/proxy/proxy.mjs
import http from 'node:http'

const UPSTREAM = process.env.UPSTREAM ?? 'http://127.0.0.1:3080'
const PORT = Number(process.env.PROXY_PORT ?? 8088)
const PUBLIC_HOST = process.env.PUBLIC_HOST ?? 'dsh.example.com'

http.createServer((req, res) => {
  const upstream = new URL(req.url ?? '/', UPSTREAM)
  // Preserve the browser's public Host: DSH must see the authority the user
  // typed and match it against --trusted-host. Rewriting Host to the upstream
  // would hide the bug instead of reproducing it.
  const headers = { ...req.headers, 'x-forwarded-host': PUBLIC_HOST, 'x-forwarded-proto': 'https' }
  const request = http.request(upstream, { method: req.method, headers }, (response) => {
    res.writeHead(response.statusCode ?? 502, response.headers)
    response.pipe(res)
  })
  request.on('error', (error) => {
    res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`proxy error: ${error.message}`)
  })
  req.pipe(request)
}).listen(PORT, '127.0.0.1', () => console.log(`proxy on http://127.0.0.1:${PORT} -> ${UPSTREAM} (Host=${PUBLIC_HOST})`))
```

浏览器访问时使用 `http://127.0.0.1:8088/` 会发送 `Host: 127.0.0.1:8088`，无法模拟公网域名。验收必须让浏览器请求的 authority 是 `dsh.example.com`：

```bash
# Playwright CLI 可用 --host-resolver-rules 映射公网域名到本机代理端口
playwright-cli open 'http://dsh.example.com:8088/' --host-resolver-rules='MAP dsh.example.com 127.0.0.1'
```

启动隔离 DSH Web（路径按本机 DSH 可执行文件替换）：

```bash
DSH_BIN="/d/code/ai/dsh-workbuddy-expert/.tmp-review/asar-full/node_modules/@deepseek-ai/dsh/bin.js"
DSH_HOME=.tmp-review/proxy/data node "$DSH_BIN" --profile web   --host 127.0.0.1 --port 3080 --no-open   --public-url http://dsh.example.com:8088   --trusted-host dsh.example.com:8088   > .tmp-review/proxy/dsh.log 2>&1 &
echo $! > .tmp-review/proxy/dsh.pid
```

启动代理：

```bash
PROXY_PORT=8088 UPSTREAM=http://127.0.0.1:3080 PUBLIC_HOST=dsh.example.com:8088 node .tmp-review/proxy/proxy.mjs > .tmp-review/proxy/proxy.log 2>&1 &
echo $! > .tmp-review/proxy/proxy.pid
```

- [ ] **Step 4: 用 Playwright 验证探测与创建**

先完成 DSH 的 token cookie 交换：从 `dsh.log` 取出 `?token=` 的完整 URL，把其中 authority 替换为 `dsh.example.com:8088`（保留 path/query），用同一 Playwright 上下文打开一次，随后打开 `http://dsh.example.com:8088/`。

在页面中：

```js
const env = await fetch('dsh-workbuddy-expert-plus/api/market/environment').then(r => r.json())
console.log(JSON.stringify(env))
```

Expected:
```json
{"status":"ready","state":{"bots":[],"models":[],"readOnly":false}}
```
不得出现 `"status":"incompatible"` 或 `"loopback Host"`。

然后点击 Bot 市场入口，选择任一专家，确认创建；Expected 页面显示「Bot 创建成功：…」，DS-Bot 状态中出现新 Bot。

截图：
```bash
playwright-cli screenshot --name dsbot-proxy-host-fixed
playwright-cli screenshot --name dsbot-proxy-host-create-fixed
```
把截图落到 `output/playwright/dsbot-proxy-host-fixed.png` 与 `output/playwright/dsbot-proxy-host-create-fixed.png`。

- [ ] **Step 5: 断言负向安全场景**

用 `curl` 直接向 DSH 监听端口发一个未信任 Host（绕过代理，模拟 DNS rebinding/恶意域名到达本机）：

```bash
curl -sS -D .tmp-review/proxy/untrusted.headers   -H 'Host: evil.example'   -H 'Origin: https://evil.example'   http://127.0.0.1:3080/dsh-workbuddy-expert-plus/api/market/environment   -o .tmp-review/proxy/untrusted.json
cat .tmp-review/proxy/untrusted.json
```
Expected: `{"status":"unknown","code":"TRUST_REQUIRED",...}`。

再用同一未信任 Host 尝试创建：

```bash
curl -sS -o .tmp-review/proxy/untrusted-create.json -w '%{http_code}'   -H 'Host: evil.example'   -H 'Origin: https://evil.example'   -H 'content-type: application/json'   -d '{"expertId":"x"}'   http://127.0.0.1:3080/dsh-workbuddy-expert-plus/api/market/bot/create
```
Expected: HTTP `403`，响应含 `"code":"TRUST_REQUIRED"`，且 `dsh.log` 中无 `create-bot` 调用记录。

- [ ] **Step 6: 更新验证报告**

在 `docs/verification-report.md` 末尾追加（执行后把 `N` 替换为实际输出数字）：

```markdown
## 2026-11-02 — DS-Bot 反向代理 Host 可用性修复

### 根因

| 现象 | 证据 | 根因 |
|---|---|---|
| Bot 弹窗显示「DS-Bot 不可用或版本不兼容」 | `/market/environment` 返回 `{status:'incompatible',reason:'DS-Bot requests require a loopback Host'}` | `createBotRequestFetch()` 把浏览器公网 `Host` 当作服务端出站目标并强制 loopback |
| 修好探测后创建仍 403 | `/market/bot/create` 的 `sameOrigin()` 同样 loopback-only | 插件复制了 DSH 的 trust 策略但只实现 loopback 子集 |

### 修复

- 入站：所有 Bot 路由委托 `ctx.connection.requestRejection({headers})`；401/403 映射为 `TRUST_REQUIRED`，缺失服务为 `TRUST_UNAVAILABLE`。
- 进程内桥接：`createBotRequestFetch({connection, request})` 用 `connection.admit()` 取 owner Peer，再用 `connection.createSharedFetchHandler('/api')` 调 `api/bot`；不发网络请求，不转发 cookie/authorization。
- 客户端：`TRUST_REQUIRED`/`BRIDGE_UNAVAILABLE`/`absent`/`unknown`/`incompatible` 分别显示可操作文案。

### 自动化证据

| 检查 | 命令 | 结果 |
|---|---|---|
| 定向测试 | `node --test test/request-fetch.test.js test/bundled-routes.test.js test/plugin-lifecycle.test.js test/client-bot-ui.test.js` | PASS：N tests |
| 全量单测 | `node --test test/*.test.js` | PASS：N tests, 0 failed |
| 完整项目链 | `npm test` | PASS：N tests + 4 smoke |
| 打包完整性 | `npm run check:package` | PASS |

### 真实反向代理验收

- 代理：`http://dsh.example.com:8088` → `http://127.0.0.1:3080`，保留公网 Host，DSH 启动带 `--trusted-host dsh.example.com:8088`。
- 探测：`{"status":"ready",...}`，无 `incompatible`。
- 创建：页面显示成功，DS-Bot 状态出现新 Bot。
- 未信任 Host（探测）：返回 `TRUST_REQUIRED`。
- 未信任 Host（创建）：HTTP 403 且响应 `code=TRUST_REQUIRED`，无 `create-bot`。
- 截图：`output/playwright/dsbot-proxy-host-fixed.png`、`output/playwright/dsbot-proxy-host-create-fixed.png`。

### 结论

反向代理导致的 loopback 误判已修复；入站信任由 DSH 统一裁决，DS-Bot 调用走进程内 owner Peer，不产生网络回环目标，也不搬运浏览器凭据。
```

- [ ] **Step 7: 提交**

```bash
git add docs/verification-report.md output/playwright/dsbot-proxy-host-fixed.png output/playwright/dsbot-proxy-host-create-fixed.png
git commit -m "docs: verify DS-Bot behind a trusted reverse proxy"
```

---

## 复核门槛

每个任务完成后必须：

1. **自检**：`git diff --stat` 只包含该任务文件；`git status --short` 无未预期文件。
2. **测试证据**：把 RED/GREEN 命令与输出摘要记录到任务报告。
3. **独立复核**：由另一个 review subagent 检查：
   - 是否仍有请求头参与出站 URL；
   - 是否仍复制 cookie/authorization；
   - 是否绕过 `requestRejection`；
   - 是否把 `TRUST_REQUIRED` 误标 `INCOMPATIBLE`；
   - 测试是否只验证 mock 而没验证真实调用契约。
4. **P0/P1 清零**：任何安全/正确性问题必须先修再进入下一任务。
5. **提交**：每个任务一个 commit，消息遵循现有 `fix:`/`docs:` 风格。

## 完成定义

- Task 1-4 的定向测试全部 GREEN。
- `node --test test/*.test.js`、`npm test`、`npm run check:package` 全部通过。
- 真实反向代理下探测为 `ready`、创建成功、未信任 Host 被拒。
- `docs/verification-report.md` 含根因、修复、命令结果、代理配置与截图路径。
- 独立代码复核 P0/P1 清零。
- 分支可合并/可发版。
