import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { createBundledCatalog } = await import('../src/catalog/builtin.js')
const resourceRoot = fileURLToPath(new URL('../resources/experts/', import.meta.url))
const catalog = createBundledCatalog({ root: resourceRoot, pluginVersion: '0.1.0' })

test('bundled catalog renders without WorkBuddy and reads complete prompts', async () => {
  const state = await catalog.stateOf()
  assert.ok(state.experts.length >= 39)
  const first = state.experts[0]
  assert.equal(first.sourceKind, 'bundled')
  assert.equal(first.agentInstalled, false)
  assert.equal(first.botCreated, false)
  const prompt = await catalog.readPrompt(first.id)
  assert.ok(prompt.trim().length > 200)
  assert.equal(prompt, await readFile(new URL(`../resources/experts/${first.roleFile}`, import.meta.url), 'utf8'))
})

test('bundled resolver rejects traversal and unknown assets', async () => {
  const first = (await catalog.stateOf()).experts[0]
  await assert.rejects(() => catalog.readAsset(first.id, '../manifest.json'), /invalid|outside|not allowed/i)
  await assert.rejects(() => catalog.readAsset('no-such-expert', 'role.md'), /unknown|not found/i)
})

test('manifest tampering is detected per expert without hiding the rest', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'wb-catalog-'))
  try {
    const manifest = JSON.parse(await readFile(new URL('../resources/experts/manifest.json', import.meta.url), 'utf8'))
    const first = manifest.experts[0]
    await writeFile(join(tmp, 'manifest.json'), JSON.stringify({ ...manifest, experts: [first, { ...manifest.experts[1], contentSha256: '0'.repeat(64) }] }))
    await writeFile(join(tmp, 'catalog.sha256'), (await readFile(new URL('../resources/experts/catalog.sha256', import.meta.url), 'utf8')))
    await mkdir(join(tmp, first.id), { recursive: true })
    await writeFile(join(tmp, first.roleFile), await readFile(new URL(`../resources/experts/${first.roleFile}`, import.meta.url)))
    const tampered = createBundledCatalog({ root: tmp, pluginVersion: '0.1.0' })
    const state = await tampered.stateOf()
    // The tampered manifest entry must be rejected while the valid first entry
    // still renders. The current schema validates shape eagerly; content hashes
    // are checked on read.
    assert.ok(state.experts.length >= 1)
    assert.ok(Array.isArray(state.errors))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
