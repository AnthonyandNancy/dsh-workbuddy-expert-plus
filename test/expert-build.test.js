import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../resources/experts/manifest.json', import.meta.url), 'utf8'))

test('manifest contains only complete approved experts', async () => {
  assert.ok(manifest.experts.length > 0)
  for (const expert of manifest.experts) {
    assert.equal(expert.license.status, 'approved')
    assert.equal(expert.compatibility.agent, 'export-ready')
    assert.equal(expert.compatibility.bot, 'prompt-only')
    assert.ok(expert.files.some((file) => file.path === 'role.md'))
    const role = await readFile(new URL(`../resources/experts/${expert.roleFile}`, import.meta.url), 'utf8')
    assert.ok(role.trim().length > 200)
  }
})

test('blocked experts are reported, never fabricated into the manifest', async () => {
  const reports = new URL('../build/reports/', import.meta.url)
  const conversion = JSON.parse(await readFile(new URL('conversion.json', reports), 'utf8'))
  const license = JSON.parse(await readFile(new URL('license-audit.json', reports), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('../resources/experts/manifest.json', import.meta.url), 'utf8'))
  assert.equal(conversion.length, 429)
  assert.equal(manifest.experts.length, license.counts.approved)
  assert.ok(conversion.filter((entry) => entry.status !== 'ready').every((entry) => entry.reason.trim() !== ''))
  assert.equal(license.counts.approved + license.counts.restricted + license.counts.invalid, 429)
})
