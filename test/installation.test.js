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
const catalog = createBundledCatalog({ root: resourceRoot, pluginVersion: '0.1.1' })

test('install exports complete bundled prompt, metadata and ownership evidence', async () => {
  const expertsRoot = await mkdtemp(join(tmpdir(), 'wb-install-'))
  try {
    const service = createInstallService({
      adapter: createBundledSourceAdapter(catalog),
      expertsRoot,
      pluginVersion: '0.1.1',
      now: () => '2026-10-28T00:00:00.000Z',
    })
    const first = await catalog.firstId()
    const result = await service.install(first)
    const role = await readFile(join(result.dir, 'role.md'), 'utf8')
    const manifest = JSON.parse(await readFile(join(result.dir, '.expert-source.json'), 'utf8'))
    assert.equal(role, await catalog.readPrompt(first))
    assert.equal(manifest.source, 'bundled')
    assert.equal(manifest.contentSha256, await catalog.fingerprint(first))
    assert.equal(manifest.pluginVersion, '0.1.1')
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
    const service = createInstallService({ adapter: createBundledSourceAdapter(catalog), expertsRoot, pluginVersion: '0.1.1' })
    await assert.rejects(() => service.install(first), /(exists|owned|refus|manifest)/i)
    assert.equal(await readFile(join(expertsRoot, first, 'role.md'), 'utf8'), 'hand-written')
  } finally {
    await rm(expertsRoot, { recursive: true, force: true })
  }
})

test('installed expert is visible to the existing DSH registry', async () => {
  const expertsRoot = await mkdtemp(join(tmpdir(), 'wb-install-registry-'))
  try {
    const service = createInstallService({ adapter: createBundledSourceAdapter(catalog), expertsRoot, pluginVersion: '0.1.1' })
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

test('a JPEG bundled avatar is installed as avatar.jpg and served as image/jpeg', async () => {
  const expertsRoot = await mkdtemp(join(tmpdir(), 'wb-install-avatar-'))
  try {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
    const expert = {
      id: 'jpeg-expert', displayName: 'JPEG', profession: 'Test', description: '',
      avatarFile: 'jpeg-expert/avatar.jpg', files: [{ path: 'role.md', sha256: 'a'.repeat(64) }],
      sourcePackage: 'p', sourceAgent: 'a', sourceRevision: 'r', bundleVersion: 'b', pluginVersion: '0.1.1',
      license: { status: 'approved', kind: 'test', evidence: 'test' },
    }
    const adapter = {
      async list() { return [expert] },
      async readPrompt() { return 'complete prompt' },
      async listSkillFiles() { return [] },
      async readAsset(_id, path) { return path === 'avatar.jpg' ? jpeg : Buffer.from('') },
      async fingerprint() { return 'f'.repeat(64) },
      async sourceRecord() { return { sourcePackage: 'p', sourceAgent: 'a', sourceRevision: 'r', bundleVersion: 'b', pluginVersion: '0.1.1' } },
    }
    // Prompt-hash check uses the manifest role hash; make it match this fixture.
    const crypto = await import('node:crypto')
    expert.files[0].sha256 = crypto.createHash('sha256').update('complete prompt').digest('hex')
    const service = createInstallService({ adapter, expertsRoot, pluginVersion: '0.1.1' })
    const result = await service.install('jpeg-expert')
    assert.equal(await readFile(join(result.dir, 'avatar.jpg')).then((b) => b[1]), 0xd8)
    assert.equal(await readFile(join(result.dir, 'avatar.png')).catch(() => undefined), undefined)
  } finally {
    await rm(expertsRoot, { recursive: true, force: true })
  }
})

test('a legacy .expert-source.json is recognised as owned, not corrupt', async () => {
  const expertsRoot = await mkdtemp(join(tmpdir(), 'wb-install-legacy-'))
  try {
    const first = await catalog.firstId()
    const dir = join(expertsRoot, first)
    const { mkdir } = await import('node:fs/promises')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'expert.yml'), `id: "${first}"\ndisplay_name: "Legacy"\n`)
    await writeFile(join(dir, 'role.md'), 'legacy role')
    await writeFile(join(dir, '.expert-source.json'), JSON.stringify({
      sourcePath: '~/.workbuddy/plugins', pluginDir: 'p', agentFile: 'a.md', fingerprint: 'f'.repeat(64), importedAt: '2026-01-01T00:00:00Z',
    }))
    const service = createInstallService({ adapter: createBundledSourceAdapter(catalog), expertsRoot, pluginVersion: '0.1.1' })
    const overlay = await service.overlay()
    assert.ok(overlay.installed.some((entry) => entry.id === first) || overlay.orphans.some((entry) => entry.id === first))
    assert.equal(overlay.broken.some((entry) => entry.id === first), false)
  } finally {
    await rm(expertsRoot, { recursive: true, force: true })
  }
})
