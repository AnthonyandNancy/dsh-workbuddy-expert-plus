/**
 * Bundled expert catalog — the only mandatory runtime data source.
 *
 * Resources resolve relative to THIS module, never cwd or a WorkBuddy home.
 * The manifest is loaded lazily once; each entry is validated independently so
 * one broken expert cannot hide the rest. Prompts and assets are read on
 * demand, verified against the manifest hash and capped in size.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createBundledResolver, sha256 } from './resolver.js'
import { normalizeExpert, normalizeManifest } from './schema.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))

/** Default package resource root (src/catalog → ../../resources/experts). */
export function defaultBundledRoot() {
  return resolve(MODULE_DIR, '..', '..', 'resources', 'experts')
}

export function createBundledCatalog({ root = defaultBundledRoot(), pluginVersion = '', maxAssetBytes, maxPromptBytes } = {}) {
  let manifestPromise
  let indexPromise
  const resolver = createBundledResolver({ root, maxAssetBytes, maxPromptBytes })

  async function loadManifest() {
    if (manifestPromise === undefined) {
      manifestPromise = (async () => {
        const manifestText = await readFile(join(root, 'manifest.json'), 'utf8')
        // The manifest checksum is the package-level integrity witness; it
        // catches any direct edit to ids, file lists or hashes without reading
        // every prompt on first paint.
        try {
          const expected = (await readFile(join(root, 'catalog.sha256'), 'utf8')).trim()
          if (expected !== sha256(Buffer.from(manifestText, 'utf8'))) {
            throw Object.assign(new Error('manifest.json does not match catalog.sha256'), { code: 'MANIFEST_HASH_MISMATCH' })
          }
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
          // A test fixture may intentionally omit catalog.sha256; production
          // packages always ship it.
        }
        return normalizeManifest(JSON.parse(manifestText))
      })().catch((error) => {
        manifestPromise = undefined
        throw error
      })
    }
    return manifestPromise
  }

  async function loadIndex() {
    if (indexPromise === undefined) {
      indexPromise = (async () => {
        const manifest = await loadManifest()
        const experts = []
        const errors = []
        for (const rawExpert of manifest.experts) {
          try {
            const expert = normalizeExpert(rawExpert, {
              bundleVersion: manifest.bundleVersion,
              pluginVersion: manifest.pluginVersion || pluginVersion,
              sourceRevision: manifest.sourceRevision,
            })
            // The aggregate hash binds the declared file list to this source
            // revision. This detects a forged/stale manifest entry without
            // reading any prompt on first paint; actual file bytes are checked
            // lazily on read/install, where a mismatch is still fail-closed.
            const orderedFiles = [...expert.files].sort((a, b) => a.path.localeCompare(b.path))
            const aggregate = sha256(Buffer.from(JSON.stringify({ revision: expert.sourceRevision, files: orderedFiles }), 'utf8'))
            if (aggregate !== expert.contentSha256) {
              throw Object.assign(new Error('contentSha256 does not match the declared file list'), { code: 'ASSET_HASH_MISMATCH' })
            }
            experts.push(expert)
          } catch (error) {
            errors.push({
              id: typeof rawExpert?.id === 'string' ? rawExpert.id : undefined,
              code: error?.code ?? 'EXPERT_INVALID',
              message: error instanceof Error ? error.message : String(error),
            })
          }
        }
        experts.sort((a, b) => a.displayName.localeCompare(b.displayName, 'zh-Hans') || a.id.localeCompare(b.id))
        return { manifest, experts, errors }
      })().catch((error) => {
        indexPromise = undefined
        throw error
      })
    }
    return indexPromise
  }

  function requireExpert(index, id) {
    const expert = index.experts.find((entry) => entry.id === id)
    if (expert === undefined) throw new Error(`unknown expert: ${String(id)}`)
    return expert
  }

  return {
    root,
    async stateOf() {
      const index = await loadIndex()
      return {
        experts: index.experts.map((expert) => ({ ...expert })),
        errors: index.errors.map((error) => ({ ...error })),
        bundleVersion: index.manifest.bundleVersion,
        pluginVersion: index.manifest.pluginVersion || pluginVersion,
        sourceRevision: index.manifest.sourceRevision,
        counts: index.manifest.counts,
      }
    },
    async readPrompt(id) {
      const index = await loadIndex()
      return (await resolver.readDeclared(requireExpert(index, id), 'role.md')).toString('utf8')
    },
    async readAsset(id, relativePath) {
      const index = await loadIndex()
      return resolver.readDeclared(requireExpert(index, id), relativePath)
    },
    async fingerprint(id) {
      return requireExpert(await loadIndex(), id).contentSha256
    },
    async sourceRecord(id) {
      const expert = requireExpert(await loadIndex(), id)
      return {
        source: 'bundled',
        sourcePackage: expert.sourcePackage,
        sourceAgent: expert.sourceAgent,
        contentSha256: expert.contentSha256,
        sourceRevision: expert.sourceRevision,
        bundleVersion: expert.bundleVersion,
        pluginVersion: expert.pluginVersion,
        license: { ...expert.license },
      }
    },
    async firstId() {
      return (await loadIndex()).experts[0]?.id
    },
    async find(id) {
      return (await loadIndex()).experts.find((entry) => entry.id === id)
    },
  }
}
