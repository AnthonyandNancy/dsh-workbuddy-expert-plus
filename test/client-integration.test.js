import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'client', 'client.js'), 'utf8')

test('the settings Agent market reads and mutates through the mounted bundled routes', () => {
  assert.match(source, /API_BASE \+ '\/market\/state'/)
  assert.match(source, /API_BASE \+ '\/market\/refresh'/)
  assert.match(source, /API_BASE \+ '\/market\/' \+ entry\.action/)
})

test('Agent cards normalize the bundled agentInstalled field without sharing Bot state', () => {
  assert.match(source, /agentInstalled === true/)
  assert.match(source, /botCreated/)
})

test('the Bot launcher and overlay share one open/close host', () => {
  assert.match(source, /BotMarketOverlayHost/)
  assert.match(source, /botMarketStore/)
  assert.match(source, /shell\.overlay/)
  assert.match(source, /sidebar\.footer\.action/)
})
