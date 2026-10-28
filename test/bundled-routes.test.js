import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { createBundledCatalog } = await import('../src/catalog/builtin.js')
const { createBundledSourceAdapter } = await import('../src/adapters/source.js')
const { createInstallService } = await import('../src/services/install-expert.js')
const { createBotService } = await import('../src/services/create-bot.js')
const { mountBundledMarketRoutes } = await import('../src/importer/bundled-routes.js')

const catalog = createBundledCatalog({ root: fileURLToPath(new URL('../resources/experts/', import.meta.url)), pluginVersion: '0.1.0' })

function fakeServer() {
  const routes = new Map()
  return {
    routes,
    register(route) { routes.set(`${route.kind} ${route.path}`, route); return () => routes.delete(`${route.kind} ${route.path}`) },
  }
}
function req({ method = 'GET', url = '/', headers = {}, body } = {}) {
  return {
    method,
    url,
    headers,
    async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)) },
  }
}
function res() {
  const r = { status: null, headers: null, chunks: [], ended: false }
  r.writeHead = (status, headers) => { r.status = status; r.headers = headers }
  r.end = (chunk) => { if (chunk !== undefined) r.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))); r.ended = true }
  Object.defineProperty(r, 'body', { get: () => JSON.parse(Buffer.concat(r.chunks).toString('utf8')) })
  return r
}

test('bundled state renders without WorkBuddy and carries both independent status fields', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-routes-'))
  try {
    const adapter = createBundledSourceAdapter(catalog)
    const installer = createInstallService({ adapter, expertsRoot: join(dir, 'experts'), pluginVersion: '0.1.0' })
    const botService = createBotService({ adapter, bindingsPath: join(dir, 'bindings.json') })
    const server = fakeServer()
    const off = mountBundledMarketRoutes(server, { catalog, installer, botService, probe: async () => ({ status: 'absent' }) })
    const stateRoute = server.routes.get('exact /dsh-workbuddy-expert-plus/api/market/state')
    const response = res()
    await stateRoute.handler(req({ url: '/dsh-workbuddy-expert-plus/api/market/state' }), response)
    assert.equal(response.status, 200)
    const body = response.body
    assert.ok(body.experts.length >= 39)
    assert.equal(body.experts[0].sourceKind, 'bundled')
    assert.equal(body.experts[0].agentInstalled, false)
    assert.equal(body.experts[0].botCreated, false)
    assert.ok(server.routes.has('exact /dsh-workbuddy-expert-plus/api/market/install'))
    assert.ok(server.routes.has('exact /dsh-workbuddy-expert-plus/api/market/bot/create'))
    off()
    assert.equal(server.routes.size, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('market prompt route returns the complete bundled prompt', async () => {
  const server = fakeServer()
  mountBundledMarketRoutes(server, { catalog })
  const id = await catalog.firstId()
  const response = res()
  await server.routes.get('exact /dsh-workbuddy-expert-plus/api/market/prompt')
    .handler(req({ url: `/dsh-workbuddy-expert-plus/api/market/prompt?id=${id}` }), response)
  assert.equal(response.status, 200)
  assert.equal(response.body.prompt, await catalog.readPrompt(id))
})

test('Bot creation rejects read-only and duplicate names before create-bot', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wb-routes-bot-'))
  try {
    const adapter = createBundledSourceAdapter(catalog)
    const calls = []
    const state = { bots: [], models: [], readOnly: 'locked' }
    const api = { async call(endpoint, payload) { calls.push({ endpoint, payload }); if (endpoint === 'state') return state; throw new Error('must not create') } }
    const botService = createBotService({ adapter, api, bindingsPath: join(dir, 'bindings.json') })
    const server = fakeServer()
    mountBundledMarketRoutes(server, { catalog, botService })
    const response = res()
    const id = await catalog.firstId()
    await server.routes.get('exact /dsh-workbuddy-expert-plus/api/market/bot/create').handler(
      req({ method: 'POST', headers: { host: '127.0.0.1:3000' }, body: { expertId: id, name: 'A', role: 'R' } }),
      response,
    )
    assert.equal(response.status, 403)
    assert.equal(calls.filter((call) => call.endpoint === 'create-bot').length, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
