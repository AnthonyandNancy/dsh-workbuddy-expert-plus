import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = readFileSync(join(fileURLToPath(new URL('..', import.meta.url)), 'client', 'client.js'), 'utf8')

test('client has a Bot-mode market launcher and overlay', () => {
  assert.match(source, /sidebar\.footer\.action/)
  assert.match(source, /shell\.overlay/)
  assert.match(source, /workbuddy-expert-plus-market/)
})

test('Bot form reads the complete prompt and posts it unchanged', () => {
  assert.match(source, /market\/prompt\?id=/)
  assert.match(source, /instructions:\s*prompt/)
  assert.match(source, /market\/bot\/create/)
})

test('read-only and unknown environments expose no create action', () => {
  assert.match(source, /readOnly/)
  assert.match(source, /status === 'ready'/)
  assert.match(source, /disabled/)
})
