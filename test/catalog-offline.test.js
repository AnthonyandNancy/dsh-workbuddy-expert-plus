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
    const tamperedText = JSON.stringify({ ...manifest, experts: [first, { ...manifest.experts[1], contentSha256: '0'.repeat(64) }] })
    await writeFile(join(tmp, 'manifest.json'), tamperedText)
    // Re-sign the tampered manifest so the package checksum passes and the
    // per-entry aggregate check is what rejects it.
    const { createHash } = await import('node:crypto')
    await writeFile(join(tmp, 'catalog.sha256'), createHash('sha256').update(Buffer.from(tamperedText, 'utf8')).digest('hex') + String.fromCharCode(10))
    const second = manifest.experts[1]
    const sourceRoot = fileURLToPath(new URL('../resources/experts/', import.meta.url))
    for (const expert of [first, second]) {
      for (const file of expert.files) {
        const target = join(tmp, expert.id, file.path)
        await mkdir(join(target, '..'), { recursive: true })
        await writeFile(target, await readFile(join(sourceRoot, expert.id, file.path)))
      }
    }
    const tampered = createBundledCatalog({ root: tmp, pluginVersion: '0.1.0' })
    const state = await tampered.stateOf()
    // Both entries declare their real role.md paths here; the second has a
    // deliberately wrong content hash. It must be excluded from the card table
    // while the first stays available.
    assert.equal(state.experts.length, 1)
    assert.ok(state.errors.some((error) => error.code === 'ASSET_HASH_MISMATCH' || /hash/i.test(error.message)))
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})

test('a manifest edited without re-signing catalog.sha256 is rejected as a package integrity failure', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'wb-catalog-sign-'))
  try {
    const manifest = JSON.parse(await readFile(new URL('../resources/experts/manifest.json', import.meta.url), 'utf8'))
    const text = JSON.stringify({ ...manifest, experts: manifest.experts.slice(0, 1) })
    await writeFile(join(tmp, 'manifest.json'), text)
    await writeFile(join(tmp, 'catalog.sha256'), '0'.repeat(64) + String.fromCharCode(10))
    const tampered = createBundledCatalog({ root: tmp, pluginVersion: '0.1.0' })
    await assert.rejects(() => tampered.stateOf(), /catalog\.sha256|manifest/i)
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }
})
