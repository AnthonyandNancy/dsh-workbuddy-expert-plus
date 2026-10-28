import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

test('package identity is the independent dual-mode plugin', () => {
  assert.equal(pkg.name, 'dsh-workbuddy-expert-plus')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.files.includes('resources/experts'))
  assert.match(pkg.scripts.test, /node --test/)
})
