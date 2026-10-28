import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(await readFile(join(root, 'resources', 'experts', 'manifest.json'), 'utf8'))
const report = JSON.parse(await readFile(join(root, 'build', 'reports', 'packaged-contents.json'), 'utf8'))

test('pack report contains the manifest and every approved role', () => {
  assert.equal(report.ok, true)
  assert.ok(report.files.includes('resources/experts/manifest.json'))
  assert.equal(report.manifestExperts, manifest.experts.length)
  assert.equal(report.catalogExperts, manifest.experts.length)
  for (const expert of manifest.experts) {
    assert.ok(report.files.includes(`resources/experts/${expert.roleFile}`), `${expert.id}: role.md packaged`)
  }
})

test('the tgz exists, has plausible size, and carries no build input', async () => {
  assert.match(report.tgz, /\.tgz$/)
  assert.ok(report.tgzBytes > 1_000_000)
  assert.ok(!report.files.some((file) => file.startsWith('vendor-input/')))
  assert.ok(!report.files.some((file) => file.startsWith('build/')))
  assert.ok(report.files.some((file) => file === 'client/client.js'))
  await stat(join(root, 'build', report.tgz))
})
