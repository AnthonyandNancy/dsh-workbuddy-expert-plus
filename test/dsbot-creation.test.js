import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { createBundledCatalog } = await import('../src/catalog/builtin.js')
const { createBundledSourceAdapter } = await import('../src/adapters/source.js')
const { createBotService } = await import('../src/services/create-bot.js')

const catalog = createBundledCatalog({ root: fileURLToPath(new URL('../resources/experts/', import.meta.url)), pluginVersion: '0.1.1' })

function fakeApi({ readOnly = null, bots = [], failOnCreate = null } = {}) {
  const calls = []
  const state = { bots: [...bots], models: [{ ref: 'model-a' }], defaultModel: 'model-a', readOnly }
  return {
    calls,
    state,
    async call(endpoint, payload, options) {
      calls.push({ endpoint, payload })
      if (endpoint === 'state') return state
      if (endpoint === 'create-bot') {
        if (failOnCreate !== null) throw failOnCreate
        const bot = { id: 'bot-1', name: payload.name, role: payload.role, instructions: payload.instructions }
        state.bots.push(bot)
        return bot
      }
      throw new Error(`unexpected endpoint ${endpoint}`)
    },
  }
}

test('create calls create-bot once and verifies the bot in state', async () => {
  const api = fakeApi()
  const service = createBotService({ adapter: createBundledSourceAdapter(catalog), api })
  const expertId = await catalog.firstId()
  const result = await service.create({ expertId, name: '产品研发专家', role: '产品研发顾问' })
  assert.equal(api.calls.filter((call) => call.endpoint === 'create-bot').length, 1)
  assert.equal(result.verified, true)
  assert.equal(result.botId, 'bot-1')
  assert.equal(api.calls.find((call) => call.endpoint === 'create-bot').payload.instructions, await catalog.readPrompt(expertId))
})

test('double submission is refused while one create is in flight', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const api = {
    state: { bots: [], models: [], readOnly: null },
    calls: [],
    async call(endpoint, payload) {
      this.calls.push(endpoint)
      if (endpoint === 'state') return this.state
      await gate
      this.state.bots.push({ id: 'bot-slow', name: payload.name })
      return { id: 'bot-slow', name: payload.name }
    },
  }
  const service = createBotService({ adapter: createBundledSourceAdapter(catalog), api })
  const expertId = await catalog.firstId()
  const first = service.create({ expertId, name: 'A', role: 'R' })
  await assert.rejects(() => service.create({ expertId, name: 'B', role: 'R' }), /already in progress/i)
  release()
  await first
})

test('read-only and duplicate names are refused before create-bot', async () => {
  const readOnly = fakeApi({ readOnly: 'locked' })
  const service = createBotService({ adapter: createBundledSourceAdapter(catalog), api: readOnly })
  const expertId = await catalog.firstId()
  await assert.rejects(() => service.create({ expertId, name: 'A', role: 'R' }), /read.?only/i)
  assert.equal(readOnly.calls.filter((call) => call.endpoint === 'create-bot').length, 0)

  const duplicate = fakeApi({ bots: [{ id: 'existing', name: 'A' }] })
  const dupService = createBotService({ adapter: createBundledSourceAdapter(catalog), api: duplicate })
  await assert.rejects(() => dupService.create({ expertId, name: 'A', role: 'R' }), /already exists/i)
  assert.equal(duplicate.calls.filter((call) => call.endpoint === 'create-bot').length, 0)
})

test('bindings persist by bot id and survive renames; deletion clears stale mapping', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-bot-bindings-'))
  try {
    const api = fakeApi()
    const service = createBotService({ adapter: createBundledSourceAdapter(catalog), api, bindingsPath: join(dir, 'bindings.json') })
    const expertId = await catalog.firstId()
    await service.create({ expertId, name: 'A', role: 'R' })
    api.state.bots[0].name = 'renamed'
    const kept = await service.bindings()
    assert.equal(kept[expertId][0].botId, 'bot-1')
    api.state.bots.length = 0
    const pruned = await service.bindings()
    assert.equal(pruned[expertId], undefined)
    const stored = JSON.parse(await readFile(join(dir, 'bindings.json'), 'utf8'))
    assert.ok(stored !== null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('an unavailable model ref is refused before create-bot', async () => {
  const api = fakeApi()
  const service = createBotService({ adapter: createBundledSourceAdapter(catalog), api })
  const expertId = await catalog.firstId()
  await assert.rejects(
    () => service.create({ expertId, name: 'A', role: 'R', model: 'not-a-model' }),
    /unknown model/i,
  )
  assert.equal(api.calls.filter((call) => call.endpoint === 'create-bot').length, 0)
})

test('an edited prompt is accepted only when based on the exact bundled prompt', async () => {
  const api = fakeApi()
  const service = createBotService({ adapter: createBundledSourceAdapter(catalog), api })
  const expertId = await catalog.firstId()
  const bundled = await catalog.readPrompt(expertId)
  const expert = await catalog.find(expertId)
  const roleHash = expert.files.find((file) => file.path === 'role.md').sha256

  await assert.rejects(
    () => service.create({ expertId, name: 'Edited A', role: 'R', instructions: `${bundled}\nEXTRA`, basePromptSha256: 'x' }),
    /baseline|bundled prompt/i,
  )
  assert.equal(api.calls.filter((call) => call.endpoint === 'create-bot').length, 0)

  const result = await service.create({
    expertId,
    name: 'Edited B',
    role: 'R',
    instructions: `${bundled}\nEXTRA`,
    basePromptSha256: roleHash,
  })
  assert.equal(result.verified, true)
  const sent = api.calls.find((call) => call.endpoint === 'create-bot')
  assert.ok(sent.payload.instructions.endsWith('\nEXTRA'))
})
