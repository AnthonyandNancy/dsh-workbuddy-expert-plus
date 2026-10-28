import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const manifest = JSON.parse(await readFile(new URL('../resources/experts/manifest.json', import.meta.url), 'utf8'))

test('every indexed workbuddyskills expert is bundled with a complete prompt', async () => {
  assert.ok(manifest.experts.length > 0)
  for (const expert of manifest.experts) {
    assert.equal(expert.compatibility.agent, 'export-ready')
    assert.equal(expert.compatibility.bot, 'prompt-only')
    assert.ok(expert.files.some((file) => file.path === 'role.md'))
    // The licence verdict is provenance, not a gate: internal builds carry the
    // real status for every entry instead of dropping the unlicensed ones.
    assert.ok(['approved', 'restricted'].includes(expert.license.status))
    const role = await readFile(new URL(`../resources/experts/${expert.roleFile}`, import.meta.url), 'utf8')
    assert.ok(role.trim().length > 200)
  }
})

test('the whole index is bundled, with licence verdicts recorded per entry', async () => {
  const reports = new URL('../build/reports/', import.meta.url)
  const conversion = JSON.parse(await readFile(new URL('conversion.json', reports), 'utf8'))
  const license = JSON.parse(await readFile(new URL('license-audit.json', reports), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('../resources/experts/manifest.json', import.meta.url), 'utf8'))
  assert.equal(conversion.length, 429)
  assert.equal(manifest.experts.length, 429, 'internal builds ship the complete index')
  // Every dropped entry must still explain itself; the internal build should not
  // drop anything for licence reasons at all.
  assert.ok(conversion.filter((entry) => entry.status !== 'ready').every((entry) => entry.reason.trim() !== ''))
  for (const entry of conversion.filter((item) => item.status !== 'ready')) {
    assert.doesNotMatch(entry.reason, /license evidence missing/)
  }
  assert.equal(license.counts.approved + license.counts.restricted + license.counts.invalid, 429)
  assert.equal(license.counts.approved, manifest.experts.filter((expert) => expert.license.status === 'approved').length)
})
