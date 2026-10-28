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

test('ExpertCard accepts a Bot action and an optional created mark', async () => {
  const vm = await import('node:vm')
  let definition
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState: (value) => [typeof value === 'function' ? value() : value, () => {}],
    useEffect: () => {},
    useRef: (value) => ({ current: value }),
    Fragment: 'Fragment',
  }
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
    console, setTimeout, clearTimeout, React,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const module = definition.factory(() => React)

  const calls = []
  const tree = module.ExpertCard({
    t: (key) => key,
    localeId: 'zh',
    expert: {
      id: 'meituan-living-assistant-meituan-living-assistant',
      displayName: '40-20 外卖券',
      profession: '美团生活助手',
      description: '帮您一键领取美团优惠券',
      categoryId: '07-SalesCommerce',
    },
    actionLabel: '创建 Bot',
    onAction: (expert) => calls.push(expert.id),
    mark: '✓ 已创建',
  })
  const rendered = JSON.stringify(tree)
  assert.match(rendered, /40-20 外卖券/)
  assert.match(rendered, /创建 Bot/)
  assert.match(rendered, /已创建/)
  assert.match(rendered, /销售商务/)
  assert.doesNotMatch(rendered, /installBtn/,
    'a Bot card must not expose the Agent install action')

  const buttons = []
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node.type === 'button') buttons.push(node)
    ;(node.children || []).forEach(walk)
  }
  walk(tree)
  assert.equal(buttons.length, 1, 'exactly the injected card action renders')
  assert.equal(buttons[0].children.join(''), '创建 Bot')
  buttons[0].props.onClick()
  assert.deepEqual(calls, ['meituan-living-assistant-meituan-living-assistant'])
})
