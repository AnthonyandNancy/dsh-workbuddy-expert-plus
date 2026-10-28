import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(root, 'client', 'client.js'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'resources', 'experts', 'manifest.json'), 'utf8'))

// The original WorkBuddy marketplace taxonomy, copied from the authoritative
// expert_center.json v1.0.0 so this regression also runs without the
// git-ignored 697 MB upstream snapshot.
const ORIGINAL_CATEGORIES = {
  '01-ProductDesign': '产品设计',
  '02-Engineering': '技术工程',
  '03-GameSpatial': '游戏空间',
  '04-DataAI': '数据智能',
  '05-MarketingGrowth': '营销增长',
  '06-ContentCreative': '内容创作',
  '07-SalesCommerce': '销售商务',
  '08-FinanceInvestment': '金融投资',
  '09-OperationsHR': '运营人力',
  '10-ProjectQuality': '项目质量',
  '11-SecurityCompliance': '法务安全',
  '12-IndustryConsultant': '行业顾问',
  '13-TencentZone': '腾讯专区',
  '14-GlobalDevelopment': '全球发展',
  '15-BackToSchool': '开学季',
}

function loadClient() {
  let definition
  const React = {
    createElement(type, props, ...children) {
      return { type, props: props || {}, children: children.flat(Infinity) }
    },
    useState(value) { return [typeof value === 'function' ? value() : value, () => {}] },
    useEffect() {},
    useRef(value) { return { current: value } },
    Fragment: 'Fragment',
  }
  const sandbox = {
    window: {
      __ModuleLoader__: { load(value) { definition = value } },
      localStorage: { getItem() { return null } },
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
    React,
  }
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client/client.js' })
  return { module: definition.factory(() => React), React, sandbox }
}

const meituan = manifest.experts.find((expert) =>
  expert.id === 'meituan-living-assistant-meituan-living-assistant')

test('bundled cards derive the authoritative categoryId', () => {
  const { module } = loadClient()
  assert.equal(module.categoryOf(meituan), '07-SalesCommerce')
  assert.equal(module.categoryKeyOf(meituan), '07-SalesCommerce')
})

test('legacy local cards still derive their category field', () => {
  const { module } = loadClient()
  assert.equal(module.categoryOf({ id: 'legacy', category: '02-Engineering' }), '02-Engineering')
  assert.equal(module.categoryOf({ id: 'both', categoryId: '04-DataAI', category: '02-Engineering' }),
    '04-DataAI', 'the catalog categoryId is authoritative when both exist')
})

test('every bundled expert lands in one of the 15 original categories', () => {
  const { module } = loadClient()
  const chips = module.categoryChipsOf(manifest.experts)
  assert.equal(chips.length, 15)
  assert.equal(chips.some((chip) => chip.id === module.NO_CATEGORY), false)
  assert.equal(chips.reduce((sum, chip) => sum + chip.count, 0), 429)
  // Array.from unwraps the vm realm's Array prototype before deep equality.
  assert.deepEqual(Array.from(chips, (chip) => chip.id).sort(),
    Object.keys(ORIGINAL_CATEGORIES).sort())
})

test('category labels are the original 15 Chinese names', () => {
  const { module } = loadClient()
  assert.equal(Object.keys(module.KNOWN_CATEGORY_LABELS).length, 15)
  for (const [id, zh] of Object.entries(ORIGINAL_CATEGORIES)) {
    assert.equal(module.categoryLabelOf(id, 'zh'), zh, id)
  }
})

test('category chips stack with search and status filters', () => {
  const { module } = loadClient()
  assert.equal(
    module.filterExperts(manifest.experts, 'all', '', '08-FinanceInvestment').length,
    39,
  )
  assert.deepEqual(
    module.filterExperts(manifest.experts, 'all', '金融投资', 'all')
      .map((expert) => expert.categoryId)
      .filter((id) => id !== '08-FinanceInvestment'),
    [],
    'a Chinese category query matches only that category',
  )
})

test('Chinese card titles prefer a Chinese field, never the id', () => {
  const { module } = loadClient()
  assert.equal(module.localeNameOf(meituan, 'zh'), '40-20 外卖券')
  assert.equal(module.localeNameOf(meituan, 'en'), '40-20 外卖券')
  assert.equal(module.localeNameOf({ id: 'x', displayName: 'CloudQ', profession: '腾讯云SRE专家' }, 'zh'),
    '腾讯云SRE专家', 'a pure-English brand yields to the Chinese profession')
  assert.equal(module.localeNameOf({ id: 'x', displayName: 'CloudQ' }, 'zh'), 'CloudQ',
    'a brand with no Chinese alternative is preserved rather than replaced by the id')
  assert.equal(module.localeNameOf({ id: 'legacy', zhName: '旧名', name: 'Old' }, 'zh'), '旧名',
    'legacy local cards keep working')
})

test('every bundled expert gets a Chinese title', () => {
  const { module } = loadClient()
  const english = manifest.experts
    .filter((expert) => !/[\u3400-\u9fff]/.test(module.localeNameOf(expert, 'zh')))
    .map((expert) => expert.id)
  assert.deepEqual(english, [], 'no expert title is left in English')
})

test('search matches the Chinese title and profession', () => {
  const { module } = loadClient()
  assert.deepEqual(
    module.filterExperts(manifest.experts, 'all', '外卖券', 'all').map((expert) => expert.id),
    ['meituan-living-assistant-meituan-living-assistant'],
  )
  assert.ok(
    module.filterExperts(manifest.experts, 'all', '美团生活助手', 'all')
      .some((expert) => expert.id === 'meituan-living-assistant-meituan-living-assistant'),
  )
})
