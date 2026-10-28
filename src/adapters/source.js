/**
 * ExpertSourceAdapter — one read interface for bundled, user and WorkBuddy
 * sources. The installer and the market never read source files directly.
 */

import { createHash } from 'node:crypto'

/** @typedef {{list(): Promise<object[]>, readPrompt(id: string): Promise<string>, readAsset(id: string, relativePath: string): Promise<Uint8Array>, listSkillFiles(id: string): Promise<Array<{path: string, sha256: string}>>, fingerprint(id: string): Promise<string>, sourceRecord(id: string): Promise<object>}} ExpertSourceAdapter */

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/** Adapt a BundledCatalog to the common source interface. */
export function createBundledSourceAdapter(catalog) {
  return {
    kind: 'bundled',
    async list() {
      return (await catalog.stateOf()).experts
    },
    readPrompt: (id) => catalog.readPrompt(id),
    readAsset: (id, path) => catalog.readAsset(id, path),
    async listSkillFiles(id) {
      const expert = await catalog.find(id)
      if (expert === undefined) throw new Error(`unknown expert: ${id}`)
      return expert.files
        .filter((file) => file.path.startsWith('skills/'))
        .map((file) => ({ path: file.path, sha256: file.sha256 }))
    },
    fingerprint: (id) => catalog.fingerprint(id),
    sourceRecord: (id) => catalog.sourceRecord(id),
  }
}
