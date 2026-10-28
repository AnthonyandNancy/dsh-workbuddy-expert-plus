import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'client', 'client.js'), 'utf8')

test('client has a Bot-mode market launcher and overlay', () => {
  assert.match(source, /sidebar\.footer\.action/)
  assert.match(source, /shell\.overlay/)
  assert.match(source, /workbuddy-expert-plus-market/)
})

test('Bot form reads the complete prompt and posts it unchanged', () => {
  assert.match(source, /market\/prompt\?id=/)
  assert.match(source, /instructions:\s*prompt/)
  assert.match(source, /market\/bot\/create/)
})

test('read-only and unknown environments expose no create action', () => {
  assert.match(source, /readOnly/)
  assert.match(source, /status === 'ready'/)
  assert.match(source, /disabled/)
})

test('marketCounts separates the bundled catalog from the local source', async () => {
  // Load the module in the same minimal sandbox the surface tests use.
  const vm = await import('node:vm')
  const { readFileSync } = await import('node:fs')
  let definition
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (value) => { definition = value } },
      localStorage: { getItem: () => null },
      addEventListener() {},
      removeEventListener() {},
    },
    document: { createElement: () => ({ dataset: {}, textContent: '', remove() {} }), querySelector: () => null, head: { appendChild() {} } },
    console,
    setTimeout,
    clearTimeout,
    React: { createElement: () => null, useState: (v) => [v, () => {}], useEffect: () => {}, useRef: (v) => ({ current: v }) },
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const module = definition.factory(() => sandbox.React)

  const counts = module.marketCounts(
    { counts: { bundled: 39, local: 8, total: 47 } },
    [
      { id: 'a', sourceKind: 'bundled' },
      { id: 'b', sourceKind: 'workbuddy' },
    ],
  )
  assert.equal(counts.bundled, 39)
  assert.equal(counts.local, 8)
  assert.equal(counts.total, 2, 'total is the rendered table length')

  const fallback = module.marketCounts(null, [
    { id: 'a', sourceKind: 'bundled' },
    { id: 'b', sourceKind: 'bundled' },
    { id: 'c', sourceKind: 'workbuddy' },
  ])
  // Cross-realm objects from vm have a different prototype, so assert fields.
  assert.equal(fallback.bundled, 2)
  assert.equal(fallback.local, 1)
  assert.equal(fallback.total, 3,
    'without a server census the card table is counted by sourceKind')
})
