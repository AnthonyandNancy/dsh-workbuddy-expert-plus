/**
 * Path-safe asset resolver for bundled experts.
 *
 * Every read is checked twice: the path must be declared in the manifest's
 * file list, and its real path must stay inside the catalog root. Reads are
 * size-capped; prompts may be long but never unbounded.
 */

import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

import { CatalogError, isSafeRelativePath } from './schema.js'

export const DEFAULT_MAX_ASSET_BYTES = 8 * 1024 * 1024
export const DEFAULT_MAX_PROMPT_BYTES = 2 * 1024 * 1024

export function isWithinRoot(root, candidate) {
  const rel = relative(root, candidate)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel)
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

export function createBundledResolver({ root, maxAssetBytes = DEFAULT_MAX_ASSET_BYTES, maxPromptBytes = DEFAULT_MAX_PROMPT_BYTES }) {
  const rootRealPromise = realpath(root)

  async function rootReal() {
    try {
      return await rootRealPromise
    } catch {
      throw new CatalogError('CATALOG_MISSING', `bundled catalog root is not readable: ${root}`)
    }
  }

  async function readDeclared(expert, declaredPath) {
    if (!isSafeRelativePath(declaredPath)) {
      throw new CatalogError('ASSET_INVALID', `invalid asset path: ${String(declaredPath)}`)
    }
    const declared = expert.files.find((file) => file.path === declaredPath)
    if (declared === undefined) {
      throw new CatalogError('ASSET_NOT_ALLOWED', `asset is not declared for expert ${expert.id}: ${declaredPath}`)
    }
    const base = await rootReal()
    const expertDir = resolve(base, expert.id)
    const candidate = resolve(expertDir, declaredPath)
    if (!isWithinRoot(base, candidate) || !isWithinRoot(expertDir, candidate)) {
      throw new CatalogError('ASSET_OUTSIDE_ROOT', `asset escapes the catalog root: ${declaredPath}`)
    }
    let candidateReal
    try {
      candidateReal = await realpath(candidate)
    } catch {
      throw new CatalogError('ASSET_MISSING', `asset is missing: ${declaredPath}`)
    }
    if (!isWithinRoot(base, candidateReal) || !isWithinRoot(expertDir, candidateReal)) {
      throw new CatalogError('ASSET_OUTSIDE_ROOT', `asset resolves outside the catalog root: ${declaredPath}`)
    }
    const info = await stat(candidateReal)
    const limit = declaredPath === 'role.md' ? maxPromptBytes : maxAssetBytes
    if (!info.isFile()) throw new CatalogError('ASSET_INVALID', `asset is not a file: ${declaredPath}`)
    if (info.size > limit) throw new CatalogError('ASSET_TOO_LARGE', `asset exceeds ${limit} bytes: ${declaredPath}`)
    const bytes = await readFile(candidateReal)
    if (sha256(bytes) !== declared.sha256) {
      throw new CatalogError('ASSET_HASH_MISMATCH', `asset hash does not match the manifest: ${declaredPath}`)
    }
    return bytes
  }

  return { readDeclared, rootReal }
}
