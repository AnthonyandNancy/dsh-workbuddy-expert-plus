import test from 'node:test'
import assert from 'node:assert/strict'

const { createBotRequestFetch } = await import('../src/adapters/request-fetch.js')

function bridgeHarness({ rejection } = {}) {
  const calls = []
  const peer = { id: 'peer-owner' }
  const connection = {
    admit(request) {
      calls.push({ kind: 'admit', headers: request.headers })
      return rejection === undefined ? { peer } : { rejection }
    },
    createSharedFetchHandler(channel) {
      calls.push({ kind: 'handler', channel })
      return {
        async fetch(request, admittedPeer) {
          calls.push({ kind: 'fetch', url: request.url, method: request.method, headers: Object.fromEntries(request.headers), peer: admittedPeer })
          return new Response(JSON.stringify({ ok: true, value: { bots: [], models: [] } }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
        },
      }
    },
  }
  return { connection, calls, peer }
}

test('the bridge sends a fixed in-process URL and the admitted owner peer', async () => {
  const harness = bridgeHarness()
  const fetch = createBotRequestFetch({
    connection: harness.connection,
    request: { headers: { host: 'dsh.example.com', cookie: 'session=abc', origin: 'https://dsh.example.com' } },
  })
  const response = await fetch('https://attacker.example/api/bot', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'session=abc', authorization: 'Bearer x', host: 'attacker.example' },
    body: '{"endpoint":"state"}',
  })
  assert.equal(response.status, 200)
  assert.deepEqual(harness.calls.filter((call) => call.kind === 'handler'), [{ kind: 'handler', channel: '/api' }])
  assert.deepEqual(harness.calls.filter((call) => call.kind === 'admit'), [{
    kind: 'admit',
    headers: { host: 'dsh.example.com', cookie: 'session=abc', origin: 'https://dsh.example.com' },
  }])
  const bridged = harness.calls.find((call) => call.kind === 'fetch')
  assert.equal(bridged.url, 'http://dsh.inprocess/api/bot')
  assert.equal(bridged.method, 'POST')
  assert.equal(bridged.headers.cookie, undefined)
  assert.equal(bridged.headers.authorization, undefined)
  assert.equal(bridged.headers.host, undefined)
  assert.equal(bridged.headers['content-type'], 'application/json')
  assert.equal(bridged.peer, harness.peer)
})

test('a rejected admission never reaches the handler', () => {
  const harness = bridgeHarness({ rejection: 403 })
  assert.throws(
    () => createBotRequestFetch({ connection: harness.connection, request: { headers: { host: 'evil.example' } } }),
    (error) => error.code === 'TRUST_REQUIRED',
  )
  assert.equal(harness.calls.some((call) => call.kind === 'fetch'), false)
})

test('missing bridge APIs fail closed', () => {
  assert.throws(
    () => createBotRequestFetch({ connection: {}, request: { headers: {} } }),
    (error) => error.code === 'BRIDGE_UNAVAILABLE',
  )
  assert.throws(
    () => createBotRequestFetch({ connection: { admit() { return { peer: {} } } }, request: { headers: {} } }),
    (error) => error.code === 'BRIDGE_UNAVAILABLE',
  )
})

test('a non-Response handler result is incompatible, not a success', async () => {
  const peer = { id: 'peer-owner' }
  const connection = {
    admit: () => ({ peer }),
    createSharedFetchHandler: () => ({ async fetch() { return { status: 200 } } }),
  }
  const fetch = createBotRequestFetch({ connection, request: { headers: {} } })
  await assert.rejects(() => fetch('api/bot', { method: 'POST', body: '{}' }), (error) => error.code === 'INCOMPATIBLE')
})

test('the bridge never calls the global fetch or any network implementation', async () => {
  const harness = bridgeHarness()
  const networkCalls = []
  const original = globalThis.fetch
  globalThis.fetch = async (...args) => { networkCalls.push(args); throw new Error('network must not be used') }
  try {
    const fetch = createBotRequestFetch({ connection: harness.connection, request: { headers: { host: 'dsh.example.com' } } })
    const response = await fetch('api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    assert.equal(response.status, 200)
    assert.deepEqual(networkCalls, [])
  } finally {
    globalThis.fetch = original
  }
})

test('array-valued incoming headers are normalized before connection.admit', () => {
  const seen = []
  const connection = {
    admit(request) { seen.push(request.headers); return { peer: { id: 'owner' } } },
    createSharedFetchHandler: () => ({ async fetch() { return Response.json({ ok: true }) } }),
  }
  createBotRequestFetch({
    connection,
    request: { headers: { host: 'dsh.example.com', cookie: ['a=1', 'b=2'], 'x-forwarded-proto': ['https'] } },
  })
  assert.deepEqual(seen[0], { host: 'dsh.example.com', cookie: 'a=1, b=2', 'x-forwarded-proto': 'https' })
})
