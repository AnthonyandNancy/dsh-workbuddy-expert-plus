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
  return {
    tree: () => instance.tree,
    rerender,
    instance,
    // Resolve only the renders the component actually scheduled. No forced
    // rerender here: a component that never subscribes must not observe a
    // surface transition, which is what makes these tests sensitive.
    async flush() {
      for (let i = 0; i < 6; i++) await Promise.resolve()
    },
  }
}

/**
 * Two-cell harness: DS-Bot owns both `sidebar.footer.action` (shell group)
 * and `conversation.input.left` (conversation group), and a group swap
 * withdraws before it installs. The third argument seeds the conversation
 * cell so a test can observe the intermediate empty ledger.
 */
function surfaceHarness(initialEntries, initialStorage, initialConversation = []) {
  let entries = initialEntries
  let conversation = initialConversation
  let stored = initialStorage
  const listeners = new Set()
  const pending = []
  const storage = {
    getItem: (key) => (key === 'ds-bot:surface' ? stored : null),
  }
  const store = module.createSurfaceStore({
    storage,
    // Mirror DSH's microtask-batched notification: the mutation queues its
    // listeners; `flush()` delivers the batch once, like SlotCore.flush().
    subscribe: (name, listener) => {
      assert.ok(name === 'sidebar.footer.action' || name === 'conversation.input.left',
        `unexpected slot subscription: ${name}`)
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    entries: (name) => (name === 'conversation.input.left' ? conversation : entries),
  })
  async function flush() {
    await Promise.resolve()
    const batch = pending.splice(0)
    for (const listener of batch) listener()
  }
  function notify() {
    for (const listener of [...listeners]) pending.push(listener)
  }
  return {
    store,
    setEntries(next) {
      entries = next
      notify()
    },
    setConversation(next) {
      conversation = next
      notify()
    },
    setStorage(next) {
      stored = next
      notify()
    },
    async transition(next) {
      this.setEntries(next)
      await flush()
    },
    async conversationTransition(next) {
      this.setConversation(next)
      await flush()
    },
    async storageTransition(next) {
      this.setStorage(next)
      await flush()
    },
    flush,
  }
}

const botOnly = [{ options: { id: 'bot-account' } }, { options: { id: 'bot-return' } }]
const agentOnly = [{ options: { id: 'bot-return' } }]

test('DS-Bot cell ids decide the surface regardless of its opaque registrant tag', () => {
  // The live DS-Bot 0.2.10 runner labels its entries with an opaque build
  // tag (observed "Kb"), not "ds-bot". The ids are what identify the cells.
  const opaqueBot = [
    { registrant: 'Kb', options: { id: 'bot-account' } },
    { registrant: 'Kb', options: { id: 'bot-return' } },
  ]
  assert.equal(surfaceHarness(opaqueBot, 'agent').store.get(), 'bot',
    'an opaque registrant still proves DS-Bot Bot mode')

  const opaqueAgent = [{ registrant: 'Kb', options: { id: 'bot-return' } }]
  assert.equal(surfaceHarness(opaqueAgent, 'agent').store.get(), 'agent',
    'the DS-Bot Agent footer is accepted with the same tag')
})

test('surface store reads Bot/Agent from the DS-Bot footer registrations in this window', () => {
  const bot = surfaceHarness(botOnly, 'agent')
  assert.equal(bot.store.get(), 'bot', 'bot-account is live proof of Bot mode even when storage is stale')

  const agent = surfaceHarness(agentOnly, 'bot')
  assert.equal(agent.store.get(), 'bot-pending',
    'a DS-Bot footer whose Bot-only entry is absent while storage says bot is not yet Agent')

  assert.equal(surfaceHarness(agentOnly, 'agent').store.get(), 'agent',
    'the same footer with storage agent is a positive Agent signal')
  assert.equal(surfaceHarness([], null).store.get(), 'unknown')
  assert.equal(surfaceHarness([], 'agent').store.get(), 'agent')
  assert.equal(surfaceHarness([], 'bot').store.get(), 'unknown',
    'a residual bot storage value without ANY DS-Bot slots is not Bot mode')
})

test('bot-pending keeps both surfaces closed but the composer hidable state is testable', async () => {
  const pending = surfaceHarness(agentOnly, 'bot')
  const launcher = renderComponent(module.BotMarketLauncher, {
    t: (key) => key,
    surfaceStore: pending.store,
    onOpen() {},
  })
  assert.equal(launcher.tree(), null, 'the launcher is hidden while the Bot skin settles')
  const seat = renderComponent(module.ComposerExpertSeat, {
    t: (key) => key,
    surfaceStore: pending.store,
    session: { id: 's' },
  })
  assert.equal(seat.tree(), null,
    'the Agent picker is hidden during a possible Bot skin swap')

  await pending.transition(agentOnly)
  await pending.storageTransition('agent')
  await launcher.flush()
  await seat.flush()
  assert.equal(launcher.tree(), null)
  assert.equal(seat.tree()?.type, module.ExpertSelector,
    'the picker returns once the Agent storage hint and footer agree')
})

test('surface store notifies through the host microtask batch when DS-Bot switches skins', async () => {
  const app = surfaceHarness(agentOnly, 'agent')
  const seen = []
  const off = app.store.subscribe((mode) => seen.push(mode))

  app.setEntries(botOnly)
  assert.equal(app.store.get(), 'agent', 'the store does not observe an unflushed mutation')
  await app.flush()
  assert.equal(app.store.get(), 'bot')
  assert.deepEqual(seen, ['bot'])

  await app.transition(agentOnly)
  assert.equal(app.store.get(), 'agent',
    'an Agent storage hint already agrees with the Agent footer')
  assert.deepEqual(seen, ['bot', 'agent'])

  await app.storageTransition('bot')
  await app.transition(agentOnly)
  assert.equal(app.store.get(), 'bot-pending',
    'bot storage plus an Agent-only footer is the ambiguous mid-swap state')
  const launcher = renderComponent(module.BotMarketLauncher, {
    t: (key) => key,
    surfaceStore: app.store,
    onOpen() {},
  })
  const seat = renderComponent(module.ComposerExpertSeat, {
    t: (key) => key,
    surfaceStore: app.store,
    session: { id: 's' },
  })
  assert.equal(launcher.tree(), null, 'pending hides the launcher')
  assert.equal(seat.tree(), null, 'pending hides the Agent picker')

  await app.storageTransition('agent')
  await launcher.flush()
  await seat.flush()
  assert.equal(app.store.get(), 'agent')
  assert.equal(seat.tree()?.type, module.ExpertSelector)

  off()
  await app.transition(botOnly)
  assert.deepEqual(seen, ['bot', 'agent', 'bot-pending', 'agent'],
    'unsubscribed listeners are released')
})

test('a cold start before the Bot footer mounts later becomes Bot without a focus event', async () => {
  const app = surfaceHarness([], 'bot')
  assert.equal(app.store.get(), 'unknown',
    'stored bot is not trusted before a DS-Bot footer exists')

  const view = renderComponent(module.ComposerExpertSeat, {
    t: (key) => key,
    surfaceStore: app.store,
    session: { id: 's' },
  })
  assert.equal(view.tree()?.type, module.ExpertSelector,
    'unknown initially renders the Agent selector')

  await app.transition(botOnly)
  await view.flush()

  assert.equal(view.tree(), null,
    'the later bot-account registration hides the picker without focus/reopen')
})

test('the sidebar launcher follows the live surface store without focus events', async () => {
  const app = surfaceHarness(agentOnly, 'bot')
  const view = renderComponent(module.BotMarketLauncher, {
    t: (key) => key,
    surfaceStore: app.store,
    onOpen() {},
  })
  assert.equal(view.tree(), null, 'Agent mode hides the Bot market launcher')

  await app.transition(botOnly)
  await view.flush()
  assert.equal(view.tree()?.type, 'button', 'Bot mode shows the launcher after the host batch')
  assert.equal(view.tree()?.props.className, 'wbx-launcher')

  await app.transition(agentOnly)
  await view.flush()
  assert.equal(view.tree(), null, 'switching back to Agent hides it after the host batch')
})

test('the composer expert seat is hidden only in Bot mode', async () => {
  const agent = surfaceHarness(agentOnly, 'agent')
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

  await bot.transition(agentOnly)
  await bot.storageTransition('agent')
  await botView.flush()
  assert.equal(botView.tree()?.type, module.ExpertSelector,
    'switching to Agent restores the picker without remounting the plugin')
})

test('leaving Bot mode closes an open market overlay and does not reopen it', async () => {
  const app = surfaceHarness(botOnly, 'agent')
  const view = renderComponent(module.BotMarketOverlayHost, {
    t: (key) => key,
    localeId: 'zh',
    surfaceStore: app.store,
  })
  assert.equal(view.tree(), null, 'the dialog starts closed')

  module.openBotMarket()
  await view.flush()
  assert.equal(view.tree()?.type, module.BotMarketOverlay,
    'opening in Bot mode mounts the dialog')

  await app.transition(agentOnly)
  await app.storageTransition('agent')
  await view.flush()
  assert.equal(view.tree(), null, 'leaving Bot mode unmounts the dialog immediately')

  await app.transition(botOnly)
  await view.flush()
  assert.equal(view.tree(), null,
    'returning to Bot mode does not resurrect a dialog the user did not reopen')

  module.openBotMarket()
  await view.flush()
  assert.equal(view.tree()?.type, module.BotMarketOverlay,
    'the launcher can open it again deliberately')
  module.closeBotMarket()
})

test('a DS-Bot group swap keeps the last settled surface through the empty window', async () => {
  const app = surfaceHarness(botOnly, 'bot', [{ options: { id: 'bot-plus' } }])
  assert.equal(app.store.get(), 'bot')

  // Bot -> Agent: reconcile() withdraws the shell and conversation groups
  // before it installs the Agent ones, so both cells are momentarily empty.
  await app.transition([])
  await app.conversationTransition([])
  assert.equal(app.store.get(), 'bot', 'the empty window must not flip the surface')

  await app.transition(agentOnly)
  await app.storageTransition('agent')
  assert.equal(app.store.get(), 'agent')

  // Agent -> Bot: the same window in the other direction.
  await app.transition([])
  await app.conversationTransition([])
  assert.equal(app.store.get(), 'agent', 'Agent stays through its own swap window')

  await app.transition(botOnly)
  await app.conversationTransition([{ options: { id: 'bot-plus' } }])
  assert.equal(app.store.get(), 'bot')
})

test('conversation.input.left bot-plus is a Bot signal on its own', () => {
  const app = surfaceHarness([], 'agent', [{ options: { id: 'bot-plus' } }])
  assert.equal(app.store.get(), 'bot',
    'the DS-Bot conversation group proves Bot mode even before the shell group settles')
})

test('bot-plus alone proves Bot mode even when bot-account never renders', () => {
  // DS-Bot 0.2.10 keeps `bot-connect` in the footer and does not mount
  // `bot-account` in this composition, so the footer alone cannot classify
  // the surface. Its Bot-only composer entry still does.
  const app = surfaceHarness([{ options: { id: 'bot-connect' } }], 'bot', [{ options: { id: 'bot-plus' } }])
  assert.equal(app.store.get(), 'bot',
    'the Bot-only composer entry is enough to show the Bot market launcher')
})
