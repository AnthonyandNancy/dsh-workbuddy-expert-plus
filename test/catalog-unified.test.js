import test from 'node:test'
import assert from 'node:assert/strict'

const { createUnifiedCatalog } = await import('../src/catalog/unified.js')

function bundledCatalog() {
  return {
    async stateOf() {
      return {
        experts: [{ id: 'bundled-expert', sourceKind: 'bundled', sourceKey: 'bundled:pkg:agent', files: [] }],
        errors: [],
        counts: { bundled: 1, local: 0, total: 1 },
      }
    },
    async readPrompt(id) { return `BUNDLED:${id}` },
    async readAsset(id) { return Buffer.from(`BUNDLED:${id}`) },
    async fingerprint(id) { return `bundled-fingerprint:${id}` },
    async find(id) { return id === 'bundled-expert' ? { id, sourceKind: 'bundled', sourceKey: 'bundled:pkg:agent' } : undefined },
    async sourceRecord(id) { return { source: 'bundled', id } },
  }
}

function localCatalog() {
  return {
    async stateOf() {
      return {
        experts: [{ id: 'local-expert', sourceKind: 'workbuddy', sourceKey: 'workbuddy:plugin:local-expert', persona: 'LOCAL' }],
        warnings: [],
      }
    },
    async readPrompt(id) { return `LOCAL:${id}` },
    async readAsset(id) { return Buffer.from(`LOCAL:${id}`) },
    async fingerprint(id) { return `local-fingerprint:${id}` },
    async find(id) { return id === 'local-expert' ? { id, sourceKind: 'workbuddy', sourceKey: 'workbuddy:plugin:local-expert' } : undefined },
    async sourceRecord(id) { return { source: 'workbuddy', id } },
  }
}

test('enabled local experts are listed and read through the local source', async () => {
  const catalog = createUnifiedCatalog({ bundled: bundledCatalog(), local: localCatalog(), localEnabled: true })
  const state = await catalog.stateOf()
  assert.deepEqual(state.experts.map((expert) => expert.id), ['bundled-expert', 'local-expert'])
  assert.equal(await catalog.readPrompt('local-expert'), 'LOCAL:local-expert')
  assert.equal(await catalog.fingerprint('local-expert'), 'local-fingerprint:local-expert')
  assert.equal((await catalog.find('local-expert')).sourceKey, 'workbuddy:plugin:local-expert')
  assert.equal((await catalog.sourceRecord('local-expert')).source, 'workbuddy')
  assert.deepEqual(Buffer.from(await catalog.readAsset('local-expert')), Buffer.from('LOCAL:local-expert'))
})

test('disabled local sources are neither listed nor readable', async () => {
  const catalog = createUnifiedCatalog({ bundled: bundledCatalog(), local: localCatalog(), localEnabled: false })
  const state = await catalog.stateOf()
  assert.deepEqual(state.experts.map((expert) => expert.id), ['bundled-expert'])
  assert.equal(await catalog.readPrompt('bundled-expert'), 'BUNDLED:bundled-expert')
  await assert.rejects(() => catalog.readPrompt('local-expert'), /unknown expert/i)
})

test('unknown ids fail closed across both sources', async () => {
  const catalog = createUnifiedCatalog({ bundled: bundledCatalog(), local: localCatalog(), localEnabled: true })
  await assert.rejects(() => catalog.readPrompt('missing'), /unknown expert/i)
  await assert.rejects(() => catalog.readAsset('missing', 'role.md'), /unknown expert/i)
  await assert.rejects(() => catalog.fingerprint('missing'), /unknown expert/i)
  await assert.rejects(() => catalog.sourceRecord('missing'), /unknown expert/i)
})

test('the bundled source keeps hash verification through the facade', async () => {
  const calls = []
  const bundled = bundledCatalog()
  const original = bundled.readPrompt
  bundled.readPrompt = async (id) => { calls.push(id); return original(id) }
  const catalog = createUnifiedCatalog({ bundled, local: localCatalog(), localEnabled: true })
  assert.equal(await catalog.readPrompt('bundled-expert'), 'BUNDLED:bundled-expert')
  assert.deepEqual(calls, ['bundled-expert'])
})
