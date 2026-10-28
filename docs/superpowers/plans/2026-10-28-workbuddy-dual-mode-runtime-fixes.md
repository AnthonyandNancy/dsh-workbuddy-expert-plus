# WorkBuddy Dual-Mode Runtime Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the three reported runtime defects in one pass: Bot creation reads the complete bundled prompt, the Bot-market sidebar entry follows a live DS-Bot Agent/Bot switch immediately, and Bot mode no longer shows the Agent-only composer expert picker while Agent mode keeps it.

**Architecture:** Keep one client bundle and one host service graph. First make the server catalog facade expose the complete read surface the mounted routes already call (`readPrompt`, `fingerprint`, `find`, `readAsset`), so Bot creation uses the same verified bundled bytes as Agent install. Then replace the one-shot/focus-only surface hint with a shared client surface store driven by Slot-registration transitions (the host-observable signal DS-Bot produces when it withdraws or installs its shell group), with `storage`/visibility as fallback refreshes. Finally apply the mode at the composer slot boundary: the same registration renders the expert selector only when the current surface is not Bot, leaving all Agent behaviour untouched.

**Tech Stack:** Node.js >=20 ESM, `node:test`, zero-build DSH client bundle (`window.__ModuleLoader__.load`), Cordis slots (`slot.inject`, `slot.register`, `ctx.slots.subscribe`, `ctx.slots.entries`), DS-Bot 0.2.3 at locked commit `4a7b55069ad300eae8be42a74f31bc170b40ead7`.

## Global Constraints

- One plugin package and one ModuleLoader id: `dsh-workbuddy-expert-plus`. Do not add a second client bundle or a second Bot fork.
- Do not modify DS-Bot's private localStorage values. Never call `localStorage.setItem('ds-bot:…')`.
- The capability probe remains authoritative for create-vs-disabled; the surface signal is UI routing only.
- Bot mode must not render the Agent composer expert selector (`conversation.input.left`); Agent mode must retain it unchanged.
- Prompt bytes must be read from the bundled catalog through the same manifest-hash verification path used by Agent install.
- No new runtime dependency; no build step for the client.
- Tests must be written first and observed failing before production edits.

---

### Task 1: Make the unified catalog expose the read surface used by market routes

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/src/catalog/unified.js`
- Test: `packages/dsh-workbuddy-expert-plus/test/bundled-routes.test.js`

**Interfaces:**
- Consumes: `createBundledCatalog()` returning `{ stateOf, readPrompt, readAsset, fingerprint, find, ... }`.
- Produces: `createUnifiedCatalog({ bundled, local, localEnabled })` returning `{ stateOf, readPrompt, readAsset, fingerprint, find, sourceRecord }`, each read method delegating to `bundled` and failing closed for unknown ids.

- [ ] **Step 1: Write the failing test**

Add to `test/bundled-routes.test.js`:

```js
const { createUnifiedCatalog } = await import('../src/catalog/unified.js')

test('the unified catalog forwards prompt and asset reads to the bundled source', async () => {
  const unified = createUnifiedCatalog({ bundled: catalog, local: undefined, localEnabled: false })
  const id = await catalog.firstId()
  assert.equal(await unified.readPrompt(id), await catalog.readPrompt(id))
  assert.equal(await unified.fingerprint(id), await catalog.fingerprint(id))
  assert.equal((await unified.find(id)).id, id)
  assert.deepEqual(Buffer.from(await unified.readAsset(id, 'role.md')), Buffer.from(await catalog.readAsset(id, 'role.md')))
  await assert.rejects(() => unified.readPrompt('missing-expert'), /unknown expert/)
})
```

Also change the prompt-route test to mount the **unified** catalog (the production object), not the raw bundled catalog:

```js
const unified = createUnifiedCatalog({ bundled: catalog, local: undefined, localEnabled: false })
mountBundledMarketRoutes(server, { catalog: unified })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test test/bundled-routes.test.js
```

Expected: FAIL — `unified.readPrompt is not a function` (the reported runtime error) and/or the prompt route returns 500.

- [ ] **Step 3: Implement minimal forwarding**

In `src/catalog/unified.js`, keep the existing `stateOf` and return the delegated read methods:

```js
const requireBundledRead = (name) => {
  if (bundled === undefined || bundled === null || typeof bundled[name] !== 'function') {
    throw new Error(`bundled catalog does not implement ${name}()`)
  }
  return bundled[name].bind(bundled)
}

return {
  stateOf,
  readPrompt: (id) => requireBundledRead('readPrompt')(id),
  readAsset: (id, relativePath) => requireBundledRead('readAsset')(id, relativePath),
  fingerprint: (id) => requireBundledRead('fingerprint')(id),
  find: (id) => requireBundledRead('find')(id),
  sourceRecord: (id) => requireBundledRead('sourceRecord')(id),
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
node --test test/bundled-routes.test.js test/catalog-offline.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-workbuddy-expert-plus/src/catalog/unified.js packages/dsh-workbuddy-expert-plus/test/bundled-routes.test.js
git commit -m "fix: forward bundled prompt reads through unified catalog"
```

---

### Task 2: Add an observable surface store and drive it from Slot transitions

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/client/client.js`
- Test: `packages/dsh-workbuddy-expert-plus/test/client-bot-ui.test.js`
- Test: `packages/dsh-workbuddy-expert-plus/test/plugin-lifecycle.test.js`

**Interfaces:**
- Consumes: `ctx.slots.subscribe(name, listener)`, `ctx.slots.entries(name)`, `window.localStorage.getItem('ds-bot:surface')`, `window` `storage` + `visibilitychange`.
- Produces: `createSurfaceStore({ storage, subscribe, entries, win, document })` with `{ get(), subscribe(listener), refresh() }`, and `botSurfaceHint(storage)` as a pure read.

- [ ] **Step 1: Write the failing tests**

Add to `test/client-bot-ui.test.js` a real runtime test (not a regex-only test):

```js
test('surface store follows slot transitions in the same window', () => {
  const listeners = new Set()
  let mode = 'bot'
  const store = module.createSurfaceStore({
    storage: { getItem: (key) => (key === 'ds-bot:surface' ? mode : null) },
    subscribe: (_key, listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    entries: () => [],
    win: undefined,
    document: undefined,
  })
  const seen = []
  store.subscribe(() => seen.push(store.get()))
  mode = 'agent'
  for (const listener of [...listeners]) listener()
  assert.deepEqual(seen, ['agent'])
})
```

Add to `test/plugin-lifecycle.test.js` a boot assertion that applying the client subscribes to `sidebar.footer.action` without polling:

```js
assert.equal(app.subscribed.has('sidebar.footer.action'), true, 'surface store listens to the DS-Bot footer cell')
assert.equal(source.includes('setInterval'), false, 'the surface is event-driven, not polled')
```

Extend the `bootClient()` slot stub with:

```js
subscribe(name, listener) {
  subscribed.add(name)
  return () => subscribed.delete(name)
},
entries() { return [] },
```

and return `subscribed` from `bootClient()`.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test test/client-bot-ui.test.js test/plugin-lifecycle.test.js
```

Expected: FAIL — `module.createSurfaceStore is not a function`; subscription set empty.

- [ ] **Step 3: Implement the surface store**

Below `botSurfaceHint`, add:

```js
function rawSurfaceOf (storage) {
  try {
    var value = storage && typeof storage.getItem === 'function' ? storage.getItem('ds-bot:surface') : null
    return value === 'agent' || value === 'bot' ? value : 'unknown'
  } catch (error) {
    return 'unknown'
  }
}

// DS-Bot's own Bot skin withdraws every shell-group slot in Agent mode and
// re-registers the footer cell in Bot mode. Those registration transitions
// are visible in this window (a same-window localStorage write is not), so
// they are the primary live signal; the stored value remains a fallback and
// a cross-window hint.
function createSurfaceStore (options) {
  var opts = options || {}
  var storage = opts.storage
  var subscribeToSlots = typeof opts.subscribe === 'function' ? opts.subscribe : function () { return function () {} }
  var entriesOf = typeof opts.entries === 'function' ? opts.entries : function () { return [] }
  var win = opts.win
  var value = 'unknown'
  var listeners = []

  function hintsBot () {
    try {
      var list = entriesOf('sidebar.footer.action')
      return Array.isArray(list) && list.some(function (entry) {
        var id = entry && entry.options ? entry.options.id : ''
        return typeof id === 'string' && id.indexOf('bot-') === 0
      })
    } catch (error) {
      return false
    }
  }

  function compute () {
    // A Bot-owned footer cell is proof this window currently paints Bot mode.
    if (hintsBot()) return 'bot'
    return rawSurfaceOf(storage)
  }

  function notify () {
    var next = compute()
    if (next === value) return
    value = next
    for (var i = 0; i < listeners.length; i++) listeners[i](value)
  }

  value = compute()
  var off = subscribeToSlots('sidebar.footer.action', notify)
  var offEntries = typeof opts.subscribeEntries === 'function' ? opts.subscribeEntries(notify) : undefined
  if (win && typeof win.addEventListener === 'function') {
    win.addEventListener('storage', notify)
    win.addEventListener('visibilitychange', notify)
  }

  return {
    get: function () { return value },
    subscribe: function (listener) {
      listeners.push(listener)
      return function () {
        var index = listeners.indexOf(listener)
        if (index >= 0) listeners.splice(index, 1)
      }
    },
    refresh: notify,
    dispose: function () {
      if (typeof off === 'function') off()
      if (typeof offEntries === 'function') offEntries()
      if (win && typeof win.removeEventListener === 'function') {
        win.removeEventListener('storage', notify)
        win.removeEventListener('visibilitychange', notify)
      }
      listeners = []
    }
  }
}
```

`botSurfaceHint(storage)` becomes `rawSurfaceOf(storage || window.localStorage)`.

In `apply(ctx)`, create one store before registration:

```js
var surfaceStore = createSurfaceStore({
  storage: typeof window === 'undefined' ? undefined : window.localStorage,
  subscribe: function (name, listener) {
    return typeof slots.subscribe === 'function' ? slots.subscribe(name, listener) : function () {}
  },
  entries: function (name) {
    return typeof slots.entries === 'function' ? slots.entries(name) : []
  },
  win: typeof window === 'undefined' ? undefined : window
})
collect(function () { surfaceStore.dispose() })
```

Pass it to the launcher via props; the launcher subscribes in `useEffect` and uses `surfaceStore.get()` as initial state.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
node --test test/client-bot-ui.test.js test/plugin-lifecycle.test.js test/client-integration.test.js
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-workbuddy-expert-plus/client/client.js packages/dsh-workbuddy-expert-plus/test/client-bot-ui.test.js packages/dsh-workbuddy-expert-plus/test/plugin-lifecycle.test.js
git commit -m "fix: follow DS-Bot surface changes through slot transitions"
```

---

### Task 3: Hide the Agent composer expert picker in Bot mode only

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/client/client.js`
- Test: `packages/dsh-workbuddy-expert-plus/test/client-dual-mode.test.js`
- Test: `packages/dsh-workbuddy-expert-plus/scripts/smoke-client.mjs`

**Interfaces:**
- Consumes: the Task 2 `surfaceStore`.
- Produces: a `ComposerExpertSeat` wrapper whose render returns `null` when `surfaceStore.get() === 'bot'`, otherwise renders `ExpertSelector`; it subscribes to the store so a live switch re-renders immediately.

- [ ] **Step 1: Write the failing tests**

Add to `test/client-dual-mode.test.js` a runtime test over exported wrappers:

```js
test('the composer seat renders the expert selector in Agent mode and hides it in Bot mode', () => {
  const store = module.createSurfaceStore({
    storage: { getItem: () => 'agent' },
    subscribe: () => () => {},
    entries: () => [],
  })
  const tree = module.ComposerExpertSeat({ t: (key) => key, surfaceStore: store, session: { id: 's' } })
  assert.equal(tree.type, module.ExpertSelector)

  const botStore = module.createSurfaceStore({
    storage: { getItem: () => 'bot' },
    subscribe: () => () => {},
    entries: () => [],
  })
  assert.equal(module.ComposerExpertSeat({ t: (key) => key, surfaceStore: botStore }), null)
})
```

Update the smoke's `conversation.input.left` assertion to render through `ComposerExpertSeat` with an Agent surface store and expect `ExpertSelector`.

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
node --test test/client-dual-mode.test.js
node scripts/smoke-client.mjs
```

Expected: FAIL — `ComposerExpertSeat is not a function`.

- [ ] **Step 3: Implement the wrapper and register it**

Add beside `ExpertSelector`:

```js
/**
 * The composer seat is shared by both hosts. In Bot mode the Bot composer
 * already owns its own "+" entry; the Agent expert picker must not appear.
 * Agent mode keeps the exact previous registration.
 */
function ComposerExpertSeat (props) {
  var store = props.surfaceStore
  var modeState = React.useState(store ? store.get() : 'unknown')
  var mode = modeState[0]
  var setMode = modeState[1]
  React.useEffect(function () {
    if (!store || typeof store.subscribe !== 'function') return undefined
    return store.subscribe(function (next) { setMode(next) })
  }, [store])
  if (mode === 'bot') return null
  return el(ExpertSelector, {
    t: props.t,
    getLocale: props.getLocale,
    session: props.session,
    sessionId: props.sessionId,
    initialData: props.initialData
  })
}
```

Change the registration body to render `ComposerExpertSeat` with `surfaceStore`.

Export `createSurfaceStore` and `ComposerExpertSeat` at the bottom.

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```bash
node --test test/client-dual-mode.test.js test/client-bot-ui.test.js test/client-integration.test.js
node scripts/smoke-client.mjs
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-workbuddy-expert-plus/client/client.js packages/dsh-workbuddy-expert-plus/test/client-dual-mode.test.js packages/dsh-workbuddy-expert-plus/scripts/smoke-client.mjs
git commit -m "fix: hide the composer expert picker in Bot mode"
```

---

### Task 4: Verify, package, and record the runtime evidence

**Files:**
- Modify: `packages/dsh-workbuddy-expert-plus/docs/verification-report.md`
- Modify: `packages/dsh-workbuddy-expert-plus/docs/compatibility-matrix.md`
- Modify: `packages/dsh-workbuddy-expert-plus/build/reports/packaged-contents.json` (regenerated)
- Modify: `packages/dsh-workbuddy-expert-plus/build/dsh-workbuddy-expert-plus-0.1.0.tgz` (regenerated)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: a repacked `.tgz` whose unpacked prompt route and client bundle contain the fixes, plus a report that distinguishes automated evidence from still-unverified physical-host gates.

- [ ] **Step 1: Run the full verification**

```bash
cd packages/dsh-workbuddy-expert-plus
node --test test/*.test.js
node scripts/smoke.mjs
node scripts/smoke-client.mjs
node scripts/smoke-importer.mjs
node scripts/smoke-install.mjs
npm run check:package
```

Expected: every test passes; `check-package` prints `ok:true` with 39 experts and all hashes verified after unpack.

- [ ] **Step 2: Add a route-level regression assertion**

In `test/bundled-routes.test.js`, after the unified-catalog prompt test, assert the exact reported failure no longer occurs:

```js
test('market prompt route served by the production unified catalog never throws readPrompt', async () => {
  const unified = createUnifiedCatalog({ bundled: catalog, local: undefined, localEnabled: false })
  const server = fakeServer()
  mountBundledMarketRoutes(server, { catalog: unified })
  const id = await catalog.firstId()
  const response = res()
  await server.routes.get('exact /dsh-workbuddy-expert-plus/api/market/prompt')
    .handler(req({ url: `/dsh-workbuddy-expert-plus/api/market/prompt?id=${id}` }), response)
  assert.equal(response.status, 200)
  assert.equal(typeof response.body.prompt, 'string')
  assert.ok(response.body.prompt.length > 0)
})
```

Run `node --test test/bundled-routes.test.js`; expected PASS.

- [ ] **Step 3: Update documentation**

In `docs/verification-report.md` add a section `## 2026-10-28 runtime defect fixes` listing:
- the unified catalog read-forwarding fix and its route test;
- the slot-transition surface store and its same-window test;
- Bot-only composer picker hiding and the Agent-preserved test;
- full test totals and package check output.

In `docs/compatibility-matrix.md`, change the Surface row to state that slot transitions are the live signal and storage is the cross-window fallback.

- [ ] **Step 4: Rebuild the package and verify unpacked bytes**

```bash
cd packages/dsh-workbuddy-expert-plus
npm pack --pack-destination build
npm run check:package
```

Expected: `ok:true`, with the regenerated `.tgz` containing the updated `client/client.js` and `src/catalog/unified.js`.

- [ ] **Step 5: Commit**

```bash
git add packages/dsh-workbuddy-expert-plus/docs/verification-report.md packages/dsh-workbuddy-expert-plus/docs/compatibility-matrix.md packages/dsh-workbuddy-expert-plus/build/reports/packaged-contents.json packages/dsh-workbuddy-expert-plus/build/dsh-workbuddy-expert-plus-0.1.0.tgz
git commit -m "docs: record dual-mode runtime fix verification"
```

---

## Self-Review

**Spec coverage**
- Reported defect 1 (`catalog.readPrompt is not a function`): Task 1 forwards the complete read surface; Task 4 asserts the production route end to end.
- Reported defect 2 (sidebar entry does not switch live): Task 2 replaces focus-only refreshes with slot-transition observation in the same window, plus cross-window storage fallback; the launcher subscribes to the shared store.
- Reported defect 3 (remove Bot composer expert entry only): Task 3 conditionally hides only the `conversation.input.left` registration under Bot mode; Agent mode renders the existing `ExpertSelector` unchanged.

**Placeholder scan**
- No `TBD`, `TODO`, “similar to Task N”, or unspecified error handling remains. Every code step contains the exact code to add.

**Type consistency**
- `createSurfaceStore` returns `{ get, subscribe, refresh, dispose }`, and both the launcher and `ComposerExpertSeat` consume `get`/`subscribe`.
- `createUnifiedCatalog` forwards the exact method names already called by `mountBundledMarketRoutes`: `readPrompt`, `fingerprint`, `find`, `readAsset`.
- The launcher prop name is `surfaceStore` in every registration and test.
