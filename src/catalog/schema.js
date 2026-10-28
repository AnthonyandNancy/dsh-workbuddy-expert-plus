/**
 * Expert DTO validation and manifest normalization.
 *
 * The built-in manifest is generated at build time, but runtime still treats it
 * as untrusted input: an installed package can be partially broken, and a
 * malformed entry must not take the whole market down.
 */

const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/
const SHA256 = /^[a-f0-9]{64}$/
const ALLOWED_LICENSE = new Set(['approved', 'restricted', 'invalid'])

export class CatalogError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'CatalogError'
    this.code = code
  }
}

export function isSafeId(value) {
  return typeof value === 'string' && SAFE_ID.test(value)
}

export function isSha256(value) {
  return typeof value === 'string' && SHA256.test(value)
}

/** True when relativePath is a normalized, relative POSIX path with no dot segments. */
export function isSafeRelativePath(value) {
  if (typeof value !== 'string' || value === '' || value.includes(String.fromCharCode(92)) || value.includes(String.fromCharCode(0))) return false
  if (value.startsWith('/') || /^[A-Za-z]:/.test(value)) return false
  const parts = value.split('/')
  return parts.every((part) => part !== '' && part !== '.' && part !== '..')
}

function stringField(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === 'string').map((entry) => entry.trim()).filter(Boolean) : []
}

/**
 * Validate one manifest expert. Returns a normalized DTO or throws a
 * CatalogError naming the exact defect.
 */
export function normalizeExpert(raw, { bundleVersion, pluginVersion, sourceRevision } = {}) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CatalogError('EXPERT_INVALID', 'expert entry is not an object')
  }
  if (!isSafeId(raw.id)) throw new CatalogError('EXPERT_INVALID', 'expert id is missing or unsafe')
  if (!isSafeRelativePath(raw.roleFile)) throw new CatalogError('EXPERT_INVALID', `${raw.id}: roleFile is not a safe relative path`)
  if (raw.avatarFile !== undefined && !isSafeRelativePath(raw.avatarFile)) {
    throw new CatalogError('EXPERT_INVALID', `${raw.id}: avatarFile is not a safe relative path`)
  }
  if (!isSha256(raw.contentSha256)) throw new CatalogError('EXPERT_INVALID', `${raw.id}: contentSha256 is not a SHA-256`)
  if (raw.license === null || typeof raw.license !== 'object' || !ALLOWED_LICENSE.has(raw.license.status)) {
    throw new CatalogError('EXPERT_INVALID', `${raw.id}: license status is invalid`)
  }
  // Internal-only build: `restricted` entries are packaged deliberately, and the
  // recorded status is surfaced as provenance rather than used as a gate.
  const files = Array.isArray(raw.files) ? raw.files.filter((file) => file !== null && typeof file === 'object') : []
  if (!files.some((file) => file.path === 'role.md' && isSha256(file.sha256))) {
    throw new CatalogError('EXPERT_INVALID', `${raw.id}: role.md hash is missing`)
  }
  for (const file of files) {
    if (!isSafeRelativePath(file.path) || !isSha256(file.sha256)) {
      throw new CatalogError('EXPERT_INVALID', `${raw.id}: file hash entry is malformed`)
    }
  }
  return {
    id: raw.id,
    source: 'bundled',
    sourceKind: 'bundled',
    sourceKey: `bundled:${stringField(raw.sourcePackage)}:${stringField(raw.sourceAgent)}`,
    sourcePackage: stringField(raw.sourcePackage),
    sourceAgent: stringField(raw.sourceAgent),
    sourceRevision: stringField(raw.sourceRevision) || stringField(sourceRevision),
    bundleVersion: stringField(bundleVersion),
    pluginVersion: stringField(pluginVersion),
    displayName: stringField(raw.displayName) || raw.id,
    profession: stringField(raw.profession),
    categoryId: stringField(raw.categoryId),
    description: stringField(raw.description),
    tags: stringArray(raw.tags),
    quickPrompts: stringArray(raw.quickPrompts),
    roleFile: raw.roleFile,
    ...(raw.avatarFile === undefined ? {} : { avatarFile: raw.avatarFile }),
    skills: stringArray(raw.skills),
    requiredCapabilities: stringArray(raw.requiredCapabilities),
    license: {
      status: raw.license.status,
      kind: stringField(raw.license.kind),
      evidence: stringField(raw.license.evidence),
    },
    compatibility: {
      agent: raw.compatibility?.agent === 'export-ready' ? 'export-ready' : 'unavailable',
      bot: raw.compatibility?.bot === 'prompt-only' ? 'prompt-only' : 'unavailable',
    },
    contentSha256: raw.contentSha256,
    files: files.map((file) => ({ path: file.path, sha256: file.sha256 })),
    agentInstalled: false,
    updatable: false,
    botCreated: false,
  }
}

/** Validate the manifest envelope; individual experts are normalized by the caller. */
export function normalizeManifest(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new CatalogError('MANIFEST_INVALID', 'manifest is not an object')
  }
  if (raw.schemaVersion !== 1) throw new CatalogError('MANIFEST_INVALID', 'unsupported manifest schemaVersion')
  if (!Array.isArray(raw.experts)) throw new CatalogError('MANIFEST_INVALID', 'manifest.experts is not an array')
  return {
    schemaVersion: 1,
    bundleVersion: stringField(raw.bundleVersion),
    pluginVersion: stringField(raw.pluginVersion),
    sourceRevision: stringField(raw.sourceRevision),
    counts: raw.counts !== null && typeof raw.counts === 'object' ? raw.counts : {},
    experts: raw.experts,
  }
}
