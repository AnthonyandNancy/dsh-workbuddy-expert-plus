import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(root, 'client', 'client.js'), 'utf8')

/**
 * A storing React stub: hooks persist across re-renders of one component
 * instance and setters schedule the microtask re-render React would run.
 */
function makeReactStub() {
  let current = null
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity) }
    },
    useState(initial) {
      const inst = current
      const index = inst.hookIndex++
      if (!(index in inst.hooks)) inst.hooks[index] = typeof initial === 'function' ? initial() : initial
      return [inst.hooks[index], (value) => {
        inst.hooks[index] = typeof value === 'function' ? value(inst.hooks[index]) : value
        inst.schedule()
      }]
    },
    useEffect(fn, deps) {
      const inst = current
      const index = inst.hookIndex++
      const previous = inst.deps[index]
      const changed = previous === undefined || deps === undefined
        || deps.length !== previous.length || deps.some((value, i) => value !== previous[i])
      if (!changed) return
      if (typeof inst.cleanups[index] === 'function') inst.cleanups[index]()
      inst.deps[index] = deps === undefined ? undefined : deps.slice()
      const off = fn()
      if (typeof off === 'function') inst.cleanups[index] = off
    },
    useRef(initial) {
      const inst = current
      const index = inst.hookIndex++
      if (!(index in inst.hooks)) inst.hooks[index] = { current: initial }
      return inst.hooks[index]
    },
    Fragment: 'Fragment',
    _bind(instance) { current = instance },
  }
  return React
}

const reactStub = makeReactStub()
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
  console,
  setTimeout,
  clearTimeout,
  React: reactStub,
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client/client.js' })
const module = definition.factory(() => reactStub)

function renderComponent(Component, props) {
  const instance = {
    hookIndex: 0, hooks: {}, deps: {}, cleanups: {}, props, tree: null, scheduled: false,
    schedule() {
      if (instance.scheduled) return
      instance.scheduled = true
      queueMicrotask(() => { instance.scheduled = false; rerender() })
    },
  }
  function rerender() {
    instance.hookIndex = 0
    reactStub._bind(instance)
    instance.tree = Component(instance.props)
    reactStub._bind(null)
  }
  rerender()
  return { tree: () => instance.tree, rerender, instance }
}

function surfaceHarness(initialEntries, initialStorage) {
  let entries = initialEntries
  const listeners = new Set()
  const storage = {
    getItem: (key) => (key === 'ds-bot:surface' ? initialStorage : null),
  }
  const store = module.createSurfaceStore({
    storage,
    subscribe: (name, listener) => {
      assert.equal(name, 'sidebar.footer.action')
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    entries: () => entries,
  })
  return {
    store,
    setEntries(next) {
      entries = next
      for (const listener of [...listeners]) listener()
    },
  }
}

const botOnly = [{ options: { id: 'bot-account' } }, { options: { id: 'bot-return' } }]
const agentOnly = [{ options: { id: 'bot-return' } }]

test('surface store reads Bot/Agent from the DS-Bot footer registrations in this window', () => {
  const bot = surfaceHarness(botOnly, 'agent')
  assert.equal(bot.store.get(), 'bot', 'bot-account is live proof of Bot mode even when storage is stale')

  const agent = surfaceHarness(agentOnly, 'bot')
  assert.equal(agent.store.get(), 'agent', 'bot-return without bot-account is live proof of Agent mode')

  assert.equal(surfaceHarness([], null).store.get(), 'unknown')
  assert.equal(surfaceHarness([], 'agent').store.get(), 'agent')
  assert.equal(surfaceHarness([], 'bot').store.get(), 'unknown',
    'a residual bot storage value without DS-Bot slots never proves Bot mode')
})

test('surface store notifies immediately when DS-Bot withdraws or installs its Bot skin', () => {
  const app = surfaceHarness(agentOnly, 'bot')
  const seen = []
  const off = app.store.subscribe((mode) => seen.push(mode))

  app.setEntries(botOnly)
  assert.equal(app.store.get(), 'bot')
  app.setEntries(agentOnly)
  assert.equal(app.store.get(), 'agent')
  assert.deepEqual(seen, ['bot', 'agent'], 'each slot mutation reaches subscribers synchronously')

  off()
  app.setEntries(botOnly)
  assert.deepEqual(seen, ['bot', 'agent'], 'unsubscribed listeners are released')
})

test('the sidebar launcher follows the live surface store without focus events', () => {
  const app = surfaceHarness(agentOnly, 'bot')
  const view = renderComponent(module.BotMarketLauncher, {
    t: (key) => key,
    surfaceStore: app.store,
    onOpen() {},
  })
  assert.equal(view.tree(), null, 'Agent mode hides the Bot market launcher')

  app.setEntries(botOnly)
  view.rerender()
  assert.equal(view.tree()?.type, 'button', 'Bot mode shows the launcher immediately')
  assert.equal(view.tree()?.props.className, 'wbx-launcher')

  app.setEntries(agentOnly)
  view.rerender()
  assert.equal(view.tree(), null, 'switching back to Agent hides it immediately')
})

test('the composer expert seat is hidden only in Bot mode', () => {
  const agent = surfaceHarness(agentOnly, 'bot')
  const agentView = renderComponent(module.ComposerExpertSeat, {
    t: (key) => key,
    surfaceStore: agent.store,
    session: { id: 's' },
  })
  assert.equal(agentView.tree()?.type, module.ExpertSelector,
    'Agent mode keeps the existing composer expert picker')

  const bot = surfaceHarness(botOnly, 'agent')
  const botView = renderComponent(module.ComposerExpertSeat, {
    t: (key) => key,
    surfaceStore: bot.store,
    session: { id: 's' },
  })
  assert.equal(botView.tree(), null, 'Bot mode removes the composer expert picker')

  bot.setEntries(agentOnly)
  botView.rerender()
  assert.equal(botView.tree()?.type, module.ExpertSelector,
    'switching to Agent restores the picker without remounting the plugin')
})
