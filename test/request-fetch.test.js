import test from 'node:test'
import assert from 'node:assert/strict'

const { createBotRequestFetch, isLoopbackAuthority } = await import('../src/adapters/request-fetch.js')

test('relative api/bot becomes an absolute loopback URL', async () => {
  const calls = []
  const fetch = createBotRequestFetch(
    { headers: { host: '127.0.0.1:53546', cookie: 'session=abc' } },
    { fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true } } },
  )
  await fetch('api/bot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
  assert.equal(calls[0].url, 'http://127.0.0.1:53546/api/bot')
  assert.equal(calls[0].init.headers.cookie, 'session=abc')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
})

test('non-loopback hosts and origins are refused', () => {
  assert.equal(isLoopbackAuthority('localhost:1'), true)
  assert.equal(isLoopbackAuthority('evil.example:1'), false)
  assert.throws(() => createBotRequestFetch({ headers: { host: 'evil.example' } }), /loopback/i)
  assert.throws(() => createBotRequestFetch({ headers: {} }, { fallbackBase: 'http://evil.example/' }), /loopback/i)
})
