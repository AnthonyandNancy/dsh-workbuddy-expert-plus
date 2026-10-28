/**
 * Agent install service: export one bundled expert into the current DSH
 * profile's experts directory.
 *
 * Ownership is the only deletion/overwrite boundary: a folder without this
 * plugin's manifest is never touched. The manifest records the source and the
 * content hash, and a post-write hash check proves the exported prompt matches
 * the manifest before reporting success.
 */

import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { ID_RE } from '../registry.js'

export const MANIFEST_NAME = '.expert-source.json'
export const EXPORT_ORDER = 200
const DIR_MODE = 0o700
const FILE_MODE = 0o600

class InstallError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'InstallError'
    this.code = code
  }
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const yml = (value) => JSON.stringify(String(value))

async function exists(path) {
  try { await stat(path); return true } catch { return false }
}

async function readOwnedManifest(dir) {
  let text
  try { text = await readFile(join(dir, MANIFEST_NAME), 'utf8') } catch { return { status: 'absent' } }
  try {
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return { status: 'corrupt' }
    if (typeof value.source !== 'string' || typeof value.contentSha256 !== 'string') return { status: 'corrupt' }
    return { status: 'ok', value }
  } catch { return { status: 'corrupt' } }
}

async function copyDeclaredAssets({ adapter, expert, dir }) {
  const skillFiles = await adapter.listSkillFiles(expert.id)
  for (const file of skillFiles) {
    const bytes = Buffer.from(await adapter.readAsset(expert.id, file.path))
    if (sha256(bytes) !== file.sha256) throw new InstallError('ASSET_HASH_MISMATCH', `${expert.id}: ${file.path} changed while installing`)
    const target = join(dir, file.path)
    await mkdir(join(target, '..'), { recursive: true })
    await writeFile(target, bytes, { mode: FILE_MODE })
    await chmod(target, FILE_MODE)
  }
  if (expert.avatarFile !== undefined) {
    const bytes = Buffer.from(await adapter.readAsset(expert.id, expert.avatarFile.replace(`${expert.id}/`, '')))
    await writeFile(join(dir, 'avatar.png'), bytes, { mode: FILE_MODE })
    await chmod(join(dir, 'avatar.png'), FILE_MODE)
  }
}

export function createInstallService({ adapter, expertsRoot, pluginVersion = '', now = () => new Date().toISOString() }) {
  async function findExpert(id) {
    if (!ID_RE.test(id)) throw new InstallError('CARD_INVALID', `invalid expert id: ${String(id)}`)
    const experts = await adapter.list()
    const expert = experts.find((entry) => entry.id === id)
    if (expert === undefined) throw new InstallError('CARD_NOT_FOUND', `expert not found: ${id}`)
    return expert
  }

  async function exportExpert(expert) {
    const dir = join(expertsRoot, expert.id)
    const existing = await readOwnedManifest(dir)
    if (existing.status === 'absent' && await exists(dir)) {
      throw new InstallError('FOLDER_EXISTS', `expert folder exists without ${MANIFEST_NAME}; refusing to overwrite: ${dir}`)
    }
    if (existing.status === 'corrupt') throw new InstallError('MANIFEST_BROKEN', `owned manifest is corrupt: ${dir}`)
    await mkdir(dir, { recursive: true })
    await chmod(dir, DIR_MODE)

    const prompt = await adapter.readPrompt(expert.id)
    const fingerprint = await adapter.fingerprint(expert.id)
    if (sha256(Buffer.from(prompt, 'utf8')) !== expert.files.find((file) => file.path === 'role.md')?.sha256) {
      throw new InstallError('PROMPT_HASH_MISMATCH', `${expert.id}: prompt does not match the catalog hash`)
    }

    const expertYml = [
      `id: ${yml(expert.id)}`,
      `display_name: ${yml(expert.displayName)}`,
      `description: ${yml(expert.description)}`,
      `order: ${EXPORT_ORDER}`,
      '',
    ].join('\n')
    await writeFile(join(dir, 'expert.yml'), expertYml, { mode: FILE_MODE })
    await chmod(join(dir, 'expert.yml'), FILE_MODE)
    await writeFile(join(dir, 'role.md'), prompt, { mode: FILE_MODE })
    await chmod(join(dir, 'role.md'), FILE_MODE)

    await rm(join(dir, 'skills'), { recursive: true, force: true })
    await copyDeclaredAssets({ adapter, expert, dir })

    const record = await adapter.sourceRecord(expert.id)
    const manifest = {
      schemaVersion: 1,
      source: 'bundled',
      sourcePackage: record.sourcePackage,
      sourceAgent: record.sourceAgent,
      contentSha256: fingerprint,
      sourceRevision: record.sourceRevision,
      bundleVersion: record.bundleVersion,
      pluginVersion: pluginVersion || record.pluginVersion,
      importedAt: now(),
    }
    await writeFile(join(dir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, { mode: FILE_MODE })
    await chmod(join(dir, MANIFEST_NAME), FILE_MODE)

    if (sha256(await readFile(join(dir, 'role.md'))) !== expert.files.find((file) => file.path === 'role.md')?.sha256) {
      throw new InstallError('POST_WRITE_HASH_MISMATCH', `${expert.id}: exported role.md failed verification`)
    }
    return {
      id: expert.id,
      dir,
      contentSha256: fingerprint,
      changed: true,
      reinstalled: existing.status === 'ok',
      source: 'bundled',
    }
  }

  return {
    async install(id) { return exportExpert(await findExpert(id)) },
    async update(id) {
      const expert = await findExpert(id)
      const dir = join(expertsRoot, expert.id)
      const manifest = await readOwnedManifest(dir)
      if (manifest.status === 'absent') throw new InstallError(await exists(dir) ? 'FOLDER_EXISTS' : 'NOT_INSTALLED', `not updatable: ${dir}`)
      if (manifest.status === 'corrupt') throw new InstallError('MANIFEST_BROKEN', `owned manifest is corrupt: ${dir}`)
      const fingerprint = await adapter.fingerprint(id)
      if (manifest.value.contentSha256 === fingerprint) return { id, dir, contentSha256: fingerprint, changed: false }
      return exportExpert(expert)
    },
    async uninstall(id) {
      if (!ID_RE.test(id)) throw new InstallError('CARD_INVALID', `invalid expert id: ${String(id)}`)
      const dir = join(expertsRoot, id)
      const manifest = await readOwnedManifest(dir)
      if (manifest.status === 'absent') throw new InstallError('NOT_EXPORTED', `refusing to delete a folder this plugin does not own: ${dir}`)
      await rm(dir, { recursive: true, force: true })
      return { id, dir, changed: true }
    },
    async overlay() {
      let entries
      try { entries = await readdir(expertsRoot, { withFileTypes: true }) } catch { return { installed: [], broken: [], orphans: [] } }
      const installed = []
      const broken = []
      const orphans = []
      const experts = new Map((await adapter.list()).map((expert) => [expert.id, expert]))
      for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
        const dir = join(expertsRoot, entry.name)
        const manifest = await readOwnedManifest(dir)
        if (manifest.status === 'absent') continue
        if (manifest.status === 'corrupt') { broken.push({ id: entry.name, dir, reason: '清单缺失，请卸载重装' }); continue }
        const expert = experts.get(entry.name)
        if (expert === undefined) { orphans.push({ id: entry.name, dir, importedAt: manifest.value.importedAt }); continue }
        const current = await adapter.fingerprint(entry.name)
        installed.push({
          id: entry.name,
          dir,
          contentSha256: manifest.value.contentSha256,
          source: manifest.value.source,
          sourcePackage: manifest.value.sourcePackage,
          importedAt: manifest.value.importedAt,
          updatable: manifest.value.contentSha256 !== current,
        })
      }
      return { installed, broken, orphans }
    },
  }
}
