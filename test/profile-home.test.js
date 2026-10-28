import test from 'node:test'
import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'

const { resolveDshHome } = await import('../src/index.js')

test('explicit config wins over profile and DSH_HOME', () => {
  assert.equal(
    resolveDshHome('/explicit/home', { DSH_PROFILE_DIR: '/profiles/desktop', DSH_HOME: '/global/.dsh' }),
    resolve('/explicit/home'),
  )
})

test('host-managed profile dir wins over the shared DSH_HOME', () => {
  assert.equal(
    resolveDshHome(undefined, { DSH_PROFILE_DIR: '/profiles/desktop', DSH_HOME: '/global/.dsh' }),
    resolve('/profiles/desktop'),
  )
})

test('falls back to DSH_HOME and then ~/.dsh', () => {
  assert.equal(resolveDshHome(undefined, { DSH_HOME: '/global/.dsh' }), resolve('/global/.dsh'))
  const fallback = resolveDshHome(undefined, {})
  assert.ok(fallback.endsWith(join('.dsh')))
})
