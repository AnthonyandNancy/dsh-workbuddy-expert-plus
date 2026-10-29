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

test('Bot market reuses the Agent card anatomy and category chips', async () => {
  const vm = await import('node:vm')
  let definition
  const instance = {
    hookIndex: 0, hooks: {}, deps: {}, cleanups: {},
    schedule() {},
  }
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(value) {
      const index = instance.hookIndex++
      if (!(index in instance.hooks)) instance.hooks[index] = typeof value === 'function' ? value() : value
      return [instance.hooks[index], () => {}]
    },
    useEffect() { instance.hookIndex++ },
    useRef(value) { instance.hookIndex++; return { current: value } },
    Fragment: 'Fragment',
  }
  const state = {
    experts: [
      {
        id: 'meituan-living-assistant-meituan-living-assistant',
        displayName: '40-20 外卖券',
        profession: '美团生活助手',
        description: '帮您一键领取美团优惠券',
        categoryId: '07-SalesCommerce',
        avatarFile: 'meituan-living-assistant-meituan-living-assistant/avatar.jpg',
        botCreated: false,
      },
      {
        id: 'uae-public-affairs-uae-public-affairs',
        displayName: '阿联酋公共事务专家',
        profession: '公共事务顾问',
        description: '专注阿联酋政府关系',
        categoryId: '14-GlobalDevelopment',
        avatarFile: 'uae-public-affairs-uae-public-affairs/avatar.png',
        botCreated: true,
      },
    ],
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
    fetch: async (url) => ({
      ok: true, status: 200,
      async json() {
        if (String(url).includes('/market/state')) return state
        if (String(url).includes('/market/environment')) return { status: 'ready', state: { bots: [], models: [] } }
        throw new Error(`unexpected ${url}`)
      },
    }),
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  const module = definition.factory(() => React)

  // Invoke the component body with the state seeded, so the render is
  // synchronous and independent of React's effect scheduler.
  instance.hooks[0] = state
  instance.hooks[1] = { status: 'ready', reason: '' }
  const dictionary = {
    search: '搜索',
    categoryAll: '全部分类',
    categoryNone: '未分类',
    categoryRowLabel: '按分类筛选',
    botCreateBtn: '创建 Bot',
    botAgainBtn: '再次创建',
    botCreatedStamp: '已创建',
  }
  const tree = module.BotMarketOverlay({
    t: (key) => dictionary[key] || key,
    localeId: 'zh',
    onClose() {},
  })
  // Expand nested component nodes (ExpertCard / AvatarFace) the way the host
  // renderer would, so the assertions cover the card internals too.
  function expand(node) {
    if (node === null || node === undefined || typeof node !== 'object') return node
    if (Array.isArray(node)) return node.map(expand)
    if (typeof node.type === 'function') return expand(node.type(node.props))
    return { ...node, children: (node.children || []).map(expand) }
  }
  const rendered = JSON.stringify(expand(tree))
  assert.match(rendered, /40-20 外卖券/)
  assert.match(rendered, /阿联酋公共事务专家/)
  assert.match(rendered, /销售商务/)
  assert.match(rendered, /全球发展/)
  assert.match(rendered, /创建 Bot/)
  assert.match(rendered, /再次创建/)
  assert.match(rendered, /wbx-avatar/)
  assert.match(rendered, /wbx-badge/)
  assert.match(rendered, /wbx-id/)
  assert.match(rendered, /wbx-catrow/)
  assert.match(rendered, /全部分类/)
  assert.doesNotMatch(rendered, /installBtn/)
})

test('the Bot launcher renders a bordered pill with an icon, label and caret', () => {
  assert.match(source, /className: 'wbx-launcher'/)
  assert.match(source, /'data-wide': props\.wide === false \? 'false' : 'true'/)
  assert.match(source, /className: 'wbx-launcher-icon'/)
  assert.match(source, /className: 'wbx-launcher-label'/)
  assert.match(source, /className: 'wbx-launcher-caret'/)
  assert.match(source, /t\('nav'\)/)
  // The caret must be presentation-only: the button label is the nav text.
  assert.match(source, /'aria-hidden': true/)
  // No host API beyond the slot owner props.
  assert.doesNotMatch(source, /useLayoutEffect/)
  assert.doesNotMatch(source, /getBoundingClientRect/)
})
