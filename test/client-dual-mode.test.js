import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const source = readFileSync(join(root, 'client', 'client.js'), 'utf8')

test('the existing client bundle still owns the Agent market seat', () => {
  assert.match(source, /settings\.section/)
  assert.match(source, /conversation\.input\.left/)
  assert.match(source, /dsh-workbuddy-expert-plus\/api/)
  assert.match(source, /install/)
})

test('the client is one bundle, not a second Bot fork', () => {
  assert.equal((source.match(/^window\.__ModuleLoader__\.load\(/gm) || []).length, 1)
  assert.match(source, /id: "dsh-workbuddy-expert-plus"/)
})
