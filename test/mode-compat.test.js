import test from 'node:test'
import assert from 'node:assert/strict'

const { resolveOperation } = await import('../src/adapters/mode.js')
const { probeDsBot } = await import('../src/adapters/environment.js')
const { toBotTemplate, validateBotFields } = await import('../src/adapters/bot-template.js')

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, async json() { return body } }
}

test('residual bot localStorage does not create a Bot when DS-Bot is absent', () => {
  assert.equal(resolveOperation({ dsBot: 'absent', surface: 'bot' }, { entry: 'harnessSettings' }, 'bot').operation, 'install')
})

test('read-only Bot mode never falls back to install', () => {
  assert.equal(resolveOperation({ dsBot: 'readOnly', surface: 'bot' }, { entry: 'botSidebar' }).operation, 'disabled')
})

test('unknown and incompatible states disable creation', () => {
  assert.equal(resolveOperation({ dsBot: 'unknown', surface: 'bot' }, { entry: 'botSidebar' }).operation, 'disabled')
  assert.equal(resolveOperation({ dsBot: 'incompatible', surface: 'bot' }, { entry: 'botSidebar' }).operation, 'disabled')
})

test('probe distinguishes absent from transient failure', async () => {
  const absent = await probeDsBot({ fetchImpl: async () => response(404, {}) })
  assert.equal(absent.status, 'absent')
  const unknown = await probeDsBot({ fetchImpl: async () => { throw new Error('offline') } })
  assert.equal(unknown.status, 'unknown')
  const readOnly = await probeDsBot({ fetchImpl: async () => response(200, { ok: true, value: { bots: [], models: [], readOnly: 'locked' } }) })
  assert.equal(readOnly.status, 'readOnly')
  const incompatible = await probeDsBot({ fetchImpl: async () => response(200, { nope: true }) })
  assert.equal(incompatible.status, 'incompatible')
})

test('template preserves the complete prompt and enforces DS-Bot field limits', () => {
  const expert = { displayName: '产品研发专家', profession: '产品研发顾问', description: 'desc' }
  const prompt = '完整 Prompt\n'.repeat(200)
  const template = toBotTemplate(expert, prompt, { models: [{ ref: 'model-a' }], defaultModel: 'model-a' })
  assert.equal(template.instructions, prompt)
  assert.equal(template.model, 'model-a')
  const tooLong = validateBotFields({ name: 'x'.repeat(41), role: 'r'.repeat(25) })
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.errors.join(' '), /40|24/)
})

test('a too-long expert name is refused, never silently truncated', () => {
  const template = toBotTemplate({ displayName: 'x'.repeat(60), profession: '短角色' }, '完整 Prompt', { models: [] })
  assert.equal(template.name, '')
  assert.equal(template.role, '短角色')
})

test('model references are validated against the live DS-Bot model list', async () => {
  const { validateModel } = await import('../src/adapters/bot-template.js')
  assert.equal(validateModel('m1', { models: [{ ref: 'm1' }] }).ok, true)
  assert.equal(validateModel('nope', { models: [{ ref: 'm1' }] }).ok, false)
  assert.equal(validateModel(undefined, { models: [] }).ok, true)
})
