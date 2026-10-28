import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(root, 'client', 'client.js'), 'utf8')

function bootClient() {
  const seats = new Map()
  const tags = []
  const listeners = new Map()
  const document = {
    createElement: () => ({
      dataset: {}, textContent: '',
      remove() { const index = tags.indexOf(this); if (index >= 0) tags.splice(index, 1) },
    }),
    querySelector: () => null,
    head: { appendChild: (tag) => tags.push(tag) },
    addEventListener(name, fn) { listeners.set(name, fn) },
    removeEventListener(name) { listeners.delete(name) },
  }
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (definition) => { sandbox.definition = definition } },
      localStorage: { getItem: () => null },
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
      register() { return () => {} },
    },
  }
  return { module, ctx, seats, tags, listeners, sandbox }
}

test('repeated apply/dispose leaves no slot registrations or style tags', () => {
  const app = bootClient()
  const first = app.module.apply(app.ctx)
  assert.ok(app.seats.has('settings.section'))
  assert.ok(app.seats.has('sidebar.footer.action'))
  assert.ok(app.seats.has('shell.overlay'))
  first()
  assert.equal(app.seats.size, 0)
  assert.equal(app.tags.length, 0)

  const second = app.module.apply(app.ctx)
  assert.ok(app.seats.has('settings.section'))
  second()
  assert.equal(app.seats.size, 0)
  assert.equal(app.tags.length, 0)
})

test('the bundle carries no DOM mutation or private DS-Bot storage writes', () => {
  assert.doesNotMatch(source, /MutationObserver/)
  assert.doesNotMatch(source, /localStorage\.setItem\(\s*['"]ds-bot:/)
  assert.doesNotMatch(source, /state\.json/)
})
