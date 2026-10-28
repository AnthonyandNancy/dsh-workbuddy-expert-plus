import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const { createBundledCatalog } = await import('../src/catalog/builtin.js')
const { createBundledSourceAdapter } = await import('../src/adapters/source.js')
const { createInstallService } = await import('../src/services/install-expert.js')
const { scanDiscoveryRoots } = await import('../src/registry.js')

const resourceRoot = fileURLToPath(new URL('../resources/experts/', import.meta.url))
const catalog = createBundledCatalog({ root: resourceRoot, pluginVersion: '0.1.0' })

test('install exports complete bundled prompt, metadata and ownership evidence', async () => {
  const expertsRoot = await mkdtemp(join(tmpdir(), 'wb-install-'))
  try {
    const service = createInstallService({
      adapter: createBundledSourceAdapter(catalog),
      expertsRoot,
      pluginVersion: '0.1.0',
      now: () => '2026-10-28T00:00:00.000Z',
    })
    const first = await catalog.firstId()
    const result = await service.install(first)
    const role = await readFile(join(result.dir, 'role.md'), 'utf8')
    const manifest = JSON.parse(await readFile(join(result.dir, '.expert-source.json'), 'utf8'))
    assert.equal(role, await catalog.readPrompt(first))
    assert.equal(manifest.source, 'bundled')
    assert.equal(manifest.contentSha256, await catalog.fingerprint(first))
    assert.equal(manifest.pluginVersion, '0.1.0')
    assert.ok((await readFile(join(result.dir, 'expert.yml'), 'utf8')).includes(`id: "${first}"`))
  } finally {
    await rm(expertsRoot, { recursive: true, force: true })
  }
})

test('install refuses to overwrite a hand-written expert folder', async () => {
  const expertsRoot = await mkdtemp(join(tmpdir(), 'wb-install-conflict-'))
  try {
    const first = await catalog.firstId()
    await writeFile(join(expertsRoot, '.keep'), '')
    const { mkdir } = await import('node:fs/promises')
    await mkdir(join(expertsRoot, first), { recursive: true })
    await writeFile(join(expertsRoot, first, 'role.md'), 'hand-written')
    const service = createInstallService({ adapter: createBundledSourceAdapter(catalog), expertsRoot, pluginVersion: '0.1.0' })
    await assert.rejects(() => service.install(first), /(exists|owned|refus|manifest)/i)
    assert.equal(await readFile(join(expertsRoot, first, 'role.md'), 'utf8'), 'hand-written')
  } finally {
    await rm(expertsRoot, { recursive: true, force: true })
  }
})

test('installed expert is visible to the existing DSH registry', async () => {
  const expertsRoot = await mkdtemp(join(tmpdir(), 'wb-install-registry-'))
  try {
    const service = createInstallService({ adapter: createBundledSourceAdapter(catalog), expertsRoot, pluginVersion: '0.1.0' })
    const first = await catalog.firstId()
    const result = await service.install(first)
    const scan = await scanDiscoveryRoots([{ path: expertsRoot, trust: 'user', rank: 200, label: 'user' }])
    const cards = scan.experts
    const card = cards.find((entry) => entry.id === first)
    assert.ok(card, 'installed card is discoverable')
    assert.notEqual(card.status, 'broken')
    assert.ok(result.dir.endsWith(first))
  } finally {
    await rm(expertsRoot, { recursive: true, force: true })
  }
})
