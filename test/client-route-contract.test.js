import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const client = readFileSync(join(root, 'client', 'client.js'), 'utf8')
const routes = readFileSync(join(root, 'src', 'importer', 'bundled-routes.js'), 'utf8')

// Extract literal paths used by the client relative to API_BASE.
const clientPaths = [...client.matchAll(/API_BASE \+ '([^'?]+)/g)].map((match) => match[1])
const required = ['/market/state', '/market/prompt', '/market/refresh', '/market/environment', '/market/bot/create']
for (const path of required) {
  test(`client path ${path} has a mounted bundled route`, () => {
    assert.ok(clientPaths.includes(path), `client uses ${path}`)
    const suffix = path.replace('/market/', '')
    assert.match(routes, new RegExp(`ROUTE_BASE\}/?${suffix}|/market/${suffix}|\$\{ROUTE_BASE\}/${suffix}`),
      `bundled-routes declares ${suffix}`)
  })
}

test('the Agent action path concatenates the expected market prefix', () => {
  assert.match(client, /API_BASE \+ '\/market\/' \+ entry\.action/)
  for (const action of ['install', 'update', 'uninstall']) {
    assert.ok(routes.includes(`engine('${action}'`), `${action} engine route exists`)
  }
})
