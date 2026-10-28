/**
 * Deterministic offline expert-catalog builder.
 *
 * Input  : vendor-input/workbuddyskills/experts (fixed upstream snapshot)
 * Output : resources/experts/<id>/{expert.json,role.md,avatar.png?,skills/...}
 *          resources/experts/manifest.json
 *          resources/experts/catalog.sha256
 *          build/reports/{inventory,conversion,license-audit,security-audit}.json
 *
 * An expert ships only when the prompt is complete AND explicit prompt-level
 * license evidence exists. Dependency licenses under license/ do not license
 * the agent instructions. Symlinks, traversal, binaries and secrets are
 * rejected; skills stay inert and are never executed.
 */

import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const INPUT_ROOT = join(PACKAGE_ROOT, 'vendor-input', 'workbuddyskills')
const EXPERTS_INPUT = join(INPUT_ROOT, 'experts')
const OUTPUT_ROOT = join(PACKAGE_ROOT, 'resources', 'experts')
const REPORT_ROOT = join(PACKAGE_ROOT, 'build', 'reports')
const SOURCE_REVISION = '7ea565af29f6bede2acc0d7b55daa300db5de3f8'
const PLUGIN_VERSION = JSON.parse(await readFile(join(PACKAGE_ROOT, 'package.json'), 'utf8')).version
const BUNDLE_VERSION = `${SOURCE_REVISION.slice(0, 12)}-${PLUGIN_VERSION}`

const MAX_PROMPT_BYTES = 512 * 1024
const MAX_AVATAR_BYTES = 160_000
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bsk-[A-Za-z0-9]{20,}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
]

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const isWithin = (root, candidate) => {
  const rel = relative(root, candidate)
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`)
}

function localized(value, fallback = '') {
  if (typeof value === 'string') return value.trim() || fallback
  if (value !== null && typeof value === 'object') {
    return String(value.zh ?? '').trim() || String(value.en ?? '').trim() || fallback
  }
  return fallback
}

function stableId(plugin, agentName) {
  return `${plugin}-${agentName}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'expert'
}

function stripFrontmatter(text) {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  if (!normalized.startsWith('---\n')) return { frontmatter: {}, body: normalized }
  const close = normalized.indexOf('\n---', 4)
  if (close < 0) return { frontmatter: {}, body: normalized }
  const block = normalized.slice(4, close)
  const frontmatter = {}
  for (const line of block.split('\n')) {
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line)
    if (match) frontmatter[match[1]] = match[2].trim().replace(/^["']|["']$/g, '')
  }
  return { frontmatter, body: normalized.slice(close + 4).replace(/^\n+/, '') }
}

async function readJson(path) {
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, ''))
}

async function isRegularFile(path) {
  try { return (await stat(path)).isFile() } catch { return false }
}

async function listAgentFiles(pluginDir) {
  try {
    return (await readdir(join(pluginDir, 'agents'), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort()
  } catch { return [] }
}

/** Walk without following symlinks; returns entries with kind. */
async function walkFiles(root, prefix = '') {
  const files = []
  let entries
  try { entries = await readdir(join(root, prefix), { withFileTypes: true }) } catch { return files }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isSymbolicLink()) files.push({ path: rel, kind: 'symlink' })
    else if (entry.isDirectory()) files.push({ path: rel, kind: 'directory' }, ...(await walkFiles(root, rel)))
    else if (entry.isFile()) files.push({ path: rel, kind: 'file' })
  }
  return files
}

async function licenseEvidence(pluginDir, pluginJson, agentText) {
  for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md']) {
    if (await isRegularFile(join(pluginDir, name))) {
      return { status: 'approved', kind: 'root-license-file', evidence: name }
    }
  }
  const spdx = /^SPDX-License-Identifier:\s*([^\s]+)/im.exec(agentText)
  if (spdx !== null) return { status: 'approved', kind: 'agent-spdx', evidence: spdx[0].trim() }
  const declared = typeof pluginJson.license === 'string' ? pluginJson.license.trim() : ''
  if (/^(MIT|ISC|BSD-[0-9]|Apache-2\.0|CC0-1\.0|CC-BY-4\.0|Unlicense)$/i.test(declared)) {
    return {
      status: 'approved',
      kind: 'plugin-json-license',
      evidence: `${declared} in .codebuddy-plugin/plugin.json; author=${localized(pluginJson.author, 'unknown')}`,
    }
  }
  return {
    status: 'restricted',
    kind: 'no-prompt-license',
    evidence: 'no root LICENSE/COPYING, SPDX identifier, or plugin.json license for the agent prompt; license/ dependency texts do not license the prompt',
  }
}

function securityFindings(paths, text) {
  const findings = []
  for (const path of paths) {
    if (path.includes('/../') || path.startsWith('../') || path.startsWith('/') || /^[A-Za-z]:/.test(path)) findings.push(`path-escape:${path}`)
    if (/\.(exe|dll|so|dylib|node|wasm)$/i.test(path)) findings.push(`binary:${path}`)
  }
  for (const pattern of SECRET_PATTERNS) if (pattern.test(text)) findings.push(`secret-pattern:${pattern}`)
  return [...new Set(findings)]
}

async function convertOne(item, pluginDir, pluginJson) {
  const agentFiles = await listAgentFiles(pluginDir)
  const agentName = String(item.agentName ?? '').trim()
  let agentFile = ''
  if (agentName !== '' && agentFiles.includes(`${agentName}.md`)) agentFile = `agents/${agentName}.md`
  else if (agentFiles.length === 1) agentFile = `agents/${agentFiles[0]}`
  const result = {
    indexId: item.id,
    sourcePackage: String(item.plugin ?? ''),
    sourceAgent: agentFile,
    displayName: localized(item.displayName, String(item.name ?? item.id ?? '')),
    profession: localized(item.profession, ''),
    categoryId: String(item.categoryId ?? ''),
    description: localized(item.description, ''),
    tags: Array.isArray(item.tags) ? item.tags.map((tag) => localized(tag)).filter(Boolean) : [],
    quickPrompts: Array.isArray(item.quickPrompts) ? item.quickPrompts.map((prompt) => localized(prompt)).filter(Boolean) : [],
    status: 'invalid', reason: '', role: '', avatarSource: '', skillFiles: [],
    license: { status: 'restricted', kind: 'none', evidence: '' }, security: [], id: '',
  }
  if (!SAFE_ID.test(result.sourcePackage)) { result.reason = 'unsafe source package name'; return result }
  if (agentFile === '') { result.reason = `prompt file not found (index: ${String(item.promptFile ?? '(none)')})`; return result }
  const agentPath = resolve(pluginDir, agentFile)
  if (!isWithin(pluginDir, agentPath)) { result.reason = 'agent path escapes plugin directory'; return result }
  const agentBytes = await readFile(agentPath)
  if (agentBytes.length > MAX_PROMPT_BYTES) { result.reason = `prompt too large (${agentBytes.length} bytes)`; return result }
  const rawAgent = agentBytes.toString('utf8')
  const { body } = stripFrontmatter(rawAgent)
  result.role = `${body.trim()}\n`
  if (body.trim().length < 120) { result.reason = 'prompt body is empty or too short'; return result }
  result.id = stableId(result.sourcePackage, agentName || agentFile.replace(/\.md$/, ''))

  if (typeof pluginJson.avatar === 'string' && pluginJson.avatar.trim() !== '') {
    const avatarPath = resolve(pluginDir, pluginJson.avatar.trim())
    if (isWithin(pluginDir, avatarPath) && await isRegularFile(avatarPath)) {
      const bytes = await readFile(avatarPath)
      if (bytes.length > 0 && bytes.length <= MAX_AVATAR_BYTES && /\.(png|jpe?g|webp)$/i.test(avatarPath)) {
        result.avatarSource = pluginJson.avatar.trim()
      }
    }
  }
  if (result.avatarSource === '') {
    try {
      const first = (await readdir(join(pluginDir, 'avatars'), { withFileTypes: true }))
        .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name)).map((entry) => entry.name).sort()[0]
      if (first !== undefined) result.avatarSource = `avatars/${first}`
    } catch { /* none */ }
  }

  const skillFiles = []
  try {
    const skillDirs = (await readdir(join(pluginDir, 'skills'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort()
    for (const skill of skillDirs) {
      const files = await walkFiles(join(pluginDir, 'skills'), skill)
      if (files.some((file) => file.kind === 'symlink')) continue
      const hasLicense = files.some((file) => file.kind === 'file' && /(^|\/)(LICEN[CS]E|COPYING)(\.|$)/i.test(file.path))
      if (!hasLicense) continue
      for (const file of files) if (file.kind === 'file') skillFiles.push(`skills/${file.path}`)
    }
  } catch { /* no skills */ }
  result.skillFiles = skillFiles
  result.license = await licenseEvidence(pluginDir, pluginJson, rawAgent)
  result.security = securityFindings(skillFiles, result.role)
  if (result.license.status !== 'approved') { result.reason = 'license evidence missing for the agent prompt'; return result }
  if (result.security.length > 0) { result.reason = `security findings: ${result.security.join(', ')}`; return result }
  result.status = 'ready'
  return result
}

async function writeConverted(converted) {
  const dir = join(OUTPUT_ROOT, converted.id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'role.md'), converted.role, { mode: 0o600 })
  const sourcePluginDir = join(EXPERTS_INPUT, converted.sourcePackage)
  let avatarFile
  if (converted.avatarSource !== '') {
    const bytes = await readFile(join(sourcePluginDir, converted.avatarSource))
    const ext = extname(converted.avatarSource).toLowerCase()
    avatarFile = `avatar${ext === '.jpeg' ? '.jpg' : ext}`
    await writeFile(join(dir, avatarFile), bytes, { mode: 0o600 })
  }
  for (const relativeSkillFile of converted.skillFiles) {
    const from = join(sourcePluginDir, relativeSkillFile)
    const to = join(dir, relativeSkillFile)
    await mkdir(dirname(to), { recursive: true })
    await writeFile(to, await readFile(from), { mode: 0o600 })
  }
  const files = [{ path: 'role.md', sha256: sha256(Buffer.from(converted.role, 'utf8')) }]
  if (avatarFile !== undefined) files.push({ path: avatarFile, sha256: sha256(await readFile(join(dir, avatarFile))) })
  for (const relativeSkillFile of converted.skillFiles) {
    files.push({ path: relativeSkillFile, sha256: sha256(await readFile(join(dir, relativeSkillFile))) })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  const contentSha256 = sha256(Buffer.from(JSON.stringify({ revision: SOURCE_REVISION, files }), 'utf8'))
  const expert = {
    schemaVersion: 1, id: converted.id, source: 'bundled',
    sourcePackage: converted.sourcePackage, sourceAgent: converted.sourceAgent,
    sourceRevision: SOURCE_REVISION, displayName: converted.displayName,
    profession: converted.profession, categoryId: converted.categoryId,
    description: converted.description, tags: converted.tags, quickPrompts: converted.quickPrompts,
    roleFile: `${converted.id}/role.md`,
    ...(avatarFile === undefined ? {} : { avatarFile: `${converted.id}/${avatarFile}` }),
    skills: [...new Set(converted.skillFiles.map((path) => path.split('/')[1]))].sort(),
    requiredCapabilities: [], license: converted.license,
    compatibility: { agent: 'export-ready', bot: 'prompt-only' },
    contentSha256, files,
  }
  await writeFile(join(dir, 'expert.json'), `${JSON.stringify(expert, null, 2)}\n`, { mode: 0o600 })
  return expert
}

async function main() {
  const center = await readJson(join(EXPERTS_INPUT, 'expert_center.json'))
  await rm(OUTPUT_ROOT, { recursive: true, force: true })
  await mkdir(OUTPUT_ROOT, { recursive: true })
  await mkdir(REPORT_ROOT, { recursive: true })
  const pluginJsonCache = new Map()
  const indexEntries = Array.isArray(center.experts) ? center.experts : []
  const agentsDiscovered = []
  const converted = []
  const inventory = {
    sourceRevision: SOURCE_REVISION, indexEntries: indexEntries.length,
    categories: Array.isArray(center.categories) ? center.categories.length : 0,
    pluginDirectories: 0, topLevelAgentFiles: 0, allFiles: 0,
    indexedAgentsFound: 0, indexedAgentsMissing: 0, unindexedAgents: 0,
    skillsDirectories: 0, avatarFiles: 0,
  }
  const dirs = (await readdir(EXPERTS_INPUT, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name).sort()
  inventory.pluginDirectories = dirs.length
  for (const dirName of dirs) {
    const pluginDir = join(EXPERTS_INPUT, dirName)
    let pluginJson = {}
    try { pluginJson = await readJson(join(pluginDir, '.codebuddy-plugin', 'plugin.json')) } catch { pluginJson = {} }
    pluginJsonCache.set(dirName, pluginJson)
    const agents = await listAgentFiles(pluginDir)
    for (const agent of agents) agentsDiscovered.push({ sourcePackage: dirName, sourceAgent: `agents/${agent}` })
    inventory.topLevelAgentFiles += agents.length
    const files = await walkFiles(pluginDir)
    inventory.allFiles += files.length
    inventory.avatarFiles += files.filter((file) => file.path.startsWith('avatars/') && file.kind === 'file').length
    inventory.skillsDirectories += files.filter((file) => /^skills\/[^/]+$/.test(file.path) && file.kind === 'directory').length
  }
  const indexedPairs = new Set()
  for (const item of indexEntries) {
    const pluginName = String(item.plugin ?? '')
    const pluginDir = join(EXPERTS_INPUT, pluginName)
    if (!isWithin(EXPERTS_INPUT, pluginDir) || !(await isRegularFile(join(pluginDir, '.codebuddy-plugin', 'plugin.json')))) {
      converted.push({ indexId: item.id, sourcePackage: pluginName, sourceAgent: '', status: 'invalid', reason: 'plugin directory or plugin.json missing', license: { status: 'invalid', kind: 'none', evidence: '' }, security: [] })
      inventory.indexedAgentsMissing += 1
      continue
    }
    const entry = await convertOne(item, pluginDir, pluginJsonCache.get(pluginName) ?? {})
    if (entry.sourceAgent !== '') indexedPairs.add(`${pluginName}/${entry.sourceAgent.split('/').pop()}`)
    converted.push(entry)
    if (entry.sourceAgent === '') inventory.indexedAgentsMissing += 1
    else inventory.indexedAgentsFound += 1
  }
  const manifestExperts = []
  for (const entry of converted) if (entry.status === 'ready') manifestExperts.push(await writeConverted(entry))
  manifestExperts.sort((a, b) => a.id.localeCompare(b.id))
  const manifest = {
    schemaVersion: 1, bundleVersion: BUNDLE_VERSION, pluginVersion: PLUGIN_VERSION,
    sourceRevision: SOURCE_REVISION, sourceUrl: 'https://github.com/infometa/workbuddyskills',
    generatedAt: '2026-10-28T00:00:00.000Z',
    counts: {
      indexed: indexEntries.length, discoveredAgents: agentsDiscovered.length,
      ready: manifestExperts.length, blocked: converted.length - manifestExperts.length,
      unindexedAgents: agentsDiscovered.filter((agent) => !indexedPairs.has(`${agent.sourcePackage}/${agent.sourceAgent.split('/').pop()}`)).length,
    },
    experts: manifestExperts,
  }
  const manifestText = `${JSON.stringify(manifest, null, 2)}\n`
  await writeFile(join(OUTPUT_ROOT, 'manifest.json'), manifestText, { mode: 0o600 })
  await writeFile(join(OUTPUT_ROOT, 'catalog.sha256'), `${sha256(Buffer.from(manifestText, 'utf8'))}\n`, { mode: 0o600 })
  const licenseCounts = { approved: 0, restricted: 0, invalid: 0 }
  for (const entry of converted) {
    if (entry.status === 'ready') licenseCounts.approved += 1
    else if (entry.license?.status === 'invalid') licenseCounts.invalid += 1
    else licenseCounts.restricted += 1
  }
  const unindexedAgents = agentsDiscovered.filter((agent) => !indexedPairs.has(`${agent.sourcePackage}/${agent.sourceAgent.split('/').pop()}`)).length
  const reports = {
    inventory: { ...inventory, indexedPlugins: new Set(indexEntries.map((item) => item.plugin)).size, unindexedAgents, discoveredAgents: agentsDiscovered },
    conversion: converted.map(({ id, indexId, sourcePackage, sourceAgent, displayName, status, reason }) => ({ id: id || null, indexId, sourcePackage, sourceAgent, displayName, status, reason })),
    'license-audit': { policy: 'Prompt-level explicit evidence only; license/ dependency texts do not license the agent prompt.', counts: licenseCounts, entries: converted.map(({ indexId, sourcePackage, id, license, status }) => ({ indexId, sourcePackage, id: id || null, status, license })) },
    'security-audit': { policy: 'Symlinks, path escapes, executable binaries, private keys and tokens are rejected; skills are inert.', findings: converted.filter((entry) => entry.security?.length > 0).map(({ indexId, security }) => ({ indexId, findings: security })) },
  }
  for (const [name, value] of Object.entries(reports)) {
    await writeFile(join(REPORT_ROOT, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  }
  console.log(JSON.stringify({ bundleVersion: BUNDLE_VERSION, indexed: indexEntries.length, discoveredAgents: agentsDiscovered.length, ready: manifestExperts.length, blocked: converted.length - manifestExperts.length, missing: inventory.indexedAgentsMissing, unindexedAgents, reports: Object.keys(reports) }, null, 2))
}

await main()
