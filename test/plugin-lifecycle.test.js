import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(root, 'client', 'client.js'), 'utf8')

function bootClient(options = {}) {
  const seats = new Map()
  const rendered = new Map()
  const registered = new Set()
  const tags = []
  const subscribed = new Set()
  let footerEntries = options.footerEntries ?? []
  let surface = options.surface ?? 'agent'
  const listeners = new Map()
  const document = {
    createElement: () => ({
      dataset: {}, textContent: '',
      remove() { const index = tags.indexOf(this); if (index >= 0) tags.splice(index, 1) },
    }),
    querySelector: () => null,
    head: { appendChild: (tag) => tags.push(tag) },
  }
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (definition) => { sandbox.definition = definition } },
      localStorage: { getItem: (key) => (key === 'ds-bot:surface' ? surface : null) },
      addEventListener() {},
      removeEventListener() {},
    },
    document,
    console,
    setTimeout,
    clearTimeout,
    CustomEvent: class {},
    React: {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
      useEffect: () => {},
      useRef: (value) => ({ current: value }),
      Fragment: 'Fragment',
    },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const module = sandbox.definition.factory(() => sandbox.React)
  const ctx = {
    locale: undefined,
    logger: { warn() {} },
    slots: {
      inject(name, setup) {
        seats.set(name, setup)
        const off = setup()
        return () => { seats.delete(name); if (typeof off === 'function') off() }
      },
      register(definition, component) {
        rendered.set(definition.name, component)
        registered.add(`${definition.name}:${definition.id ?? ''}`)
        return () => {
          rendered.delete(definition.name)
          registered.delete(`${definition.name}:${definition.id ?? ''}`)
        }
      },
      subscribe(name, listener) {
        subscribed.add(name)
        const set = listeners.get(name) ?? new Set()
        set.add(listener)
        listeners.set(name, set)
        return () => {
          set.delete(listener)
          if (set.size === 0) subscribed.delete(name)
        }
      },
      entries(name) {
        return name === 'sidebar.footer.action' ? footerEntries : []
      },
    },
  }
  async function setSurface(next) {
    surface = next
    footerEntries = next === 'bot'
      ? [{ options: { id: 'bot-account' } }, { options: { id: 'bot-return' } }]
      : [{ options: { id: 'bot-return' } }]
    for (const listener of [...(listeners.get('sidebar.footer.action') ?? [])]) listener()
    for (const listener of [...(listeners.get('conversation.input.left') ?? [])]) listener()
    await Promise.resolve()
  }
  return { module, ctx, seats, rendered, registered, tags, sandbox, subscribed, setSurface }
}

test('repeated apply/dispose leaves no slot registrations or style tags', () => {
  const app = bootClient()
  const first = app.module.apply(app.ctx)
  for (const seat of ['settings.section', 'sidebar.footer.action', 'shell.overlay']) {
    assert.ok(app.seats.has(seat), `${seat} setup ran`)
    assert.ok(app.rendered.has(seat), `${seat} component registered`)
  }
  // Render every registered seat and the market page: no throw, real tree.
  for (const [seat, component] of app.rendered) {
    const tree = component({ t: (key) => key, view: 'page', form: undefined })
    assert.ok(tree !== undefined && typeof tree === 'object', `${seat} renders a tree`)
  }
  first()
  assert.equal(app.seats.size, 0)
  assert.equal(app.rendered.size, 0)
  assert.equal(app.tags.length, 0)

  const second = app.module.apply(app.ctx)
  assert.ok(app.seats.has('settings.section'))
  assert.deepEqual([...app.subscribed].sort(), ['conversation.input.left', 'sidebar.footer.action'],
    'each apply observes both DS-Bot group cells and releases them on dispose')
  second()
  assert.equal(app.seats.size, 0)
  assert.equal(app.tags.length, 0)
  assert.equal(app.subscribed.size, 0, 'the surface subscription is disposed with the plugin')
})

test('the bundle carries no DOM mutation or private DS-Bot storage writes', () => {
  assert.doesNotMatch(source, /MutationObserver/)
  assert.doesNotMatch(source, /localStorage\.setItem\(\s*['"]ds-bot:/)
  assert.doesNotMatch(source, /state\.json/)
})

test('the composer expert entry leaves the slot ledger in Bot mode', async () => {
  const app = bootClient({ surface: 'agent', footerEntries: [{ options: { id: 'bot-return' } }] })
  const dispose = app.module.apply(app.ctx)
  assert.equal(app.registered.has('conversation.input.left:workbuddy-expert'), true,
    'Agent mode registers the picker')

  await app.setSurface('bot')
  assert.equal(app.registered.has('conversation.input.left:workbuddy-expert'), false,
    'Bot mode must not keep a null-rendering entry in the composer list')

  await app.setSurface('agent')
  assert.equal(app.registered.has('conversation.input.left:workbuddy-expert'), true,
    'Agent mode re-registers the picker')

  dispose()
  assert.equal(app.registered.size, 0, 'dispose releases every slot entry')
})
