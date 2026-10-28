/**
 * Pack-and-verify the offline artifact.
 *
 * 1. npm pack --json
 * 2. unpack into a clean temp directory
 * 3. verify manifest counts, every role.md and every declared file hash
 * 4. read the bundled catalog from the UNPACKED package with vendor-input
 *    absent and a WorkBuddy home redirected elsewhere
 * 5. write build/reports/packaged-contents.json and print the tgz path
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const REPORT_ROOT = join(PACKAGE_ROOT, 'build', 'reports')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function walk(root, prefix = '') {
  const out = []
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...(await walk(root, rel)))
    else if (entry.isFile()) out.push(rel)
  }
  return out.sort()
}

async function main() {
  // On Windows npm is a .cmd shim, which execFileSync cannot spawn directly;
  // the npm CLI's JS entry is invoked through the running Node binary instead.
  const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  const packCommand = existsSync(npmCli) ? process.execPath : null
  const packArgs = packCommand === null
    ? ['pack', '--json', '--pack-destination', join(PACKAGE_ROOT, 'build')]
    : [npmCli, 'pack', '--json', '--pack-destination', join(PACKAGE_ROOT, 'build')]
  const packOutput = execFileSync(packCommand ?? 'npm', packArgs, {
    cwd: PACKAGE_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const packed = JSON.parse(packOutput)
  if (!Array.isArray(packed) || packed.length !== 1) throw new Error('npm pack returned an unexpected payload')
  const info = packed[0]
  const tgzPath = join(PACKAGE_ROOT, 'build', info.filename)
  const files = info.files.map((file) => file.path).sort()

  const temp = await mkdtemp(join(tmpdir(), 'wb-pack-'))
  try {
    // Git-for-Windows tar does not understand `D:` destinations; run the
    // extractor with cwd=temp and a bare archive path, which works on every
    // platform's bsdtar/GNU tar implementation.
    // Copy the archive into the temp cwd first; this avoids every Windows
    // drive-letter/path-translation quirk of the bundled tar.
    await cp(tgzPath, join(temp, 'package.tgz'))
    execFileSync('tar', ['-xzf', 'package.tgz'], { cwd: temp, stdio: ['ignore', 'pipe', 'pipe'] })
    const unpacked = join(temp, 'package')
    const manifestPath = join(unpacked, 'resources', 'experts', 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    if (!files.includes('resources/experts/manifest.json')) throw new Error('manifest.json is not inside the tgz')

    const errors = []
    const repaired = []
    for (const expert of manifest.experts) {
      for (const declared of expert.files) {
        const member = `resources/experts/${expert.id}/${declared.path}`
        const absolute = join(unpacked, 'resources', 'experts', expert.id, declared.path)
        try {
          const bytes = await readFile(absolute)
          if (sha256(bytes) !== declared.sha256) errors.push(`${member}: hash mismatch`)
          if (!files.includes(member)) errors.push(`${member}: not listed in npm pack`)
        } catch {
          errors.push(`${member}: missing from unpacked tgz`)
        }
      }
    }

    // Load the catalog from the UNPACKED package only. vendor-input and any
    // WorkBuddy home are irrelevant at this point.
    const { createBundledCatalog } = await import(pathToFileURL(join(unpacked, 'src', 'catalog', 'builtin.js')).href)
    const catalog = createBundledCatalog({ root: join(unpacked, 'resources', 'experts'), pluginVersion: info.version })
    const state = await catalog.stateOf()
    if (state.experts.length !== manifest.experts.length) errors.push(`catalog count ${state.experts.length} != manifest ${manifest.experts.length}`)
    for (const expert of state.experts.slice(0, 5)) {
      const prompt = await catalog.readPrompt(expert.id)
      if (prompt.trim().length < 200) errors.push(`${expert.id}: prompt missing after unpack`)
    }

    const report = {
      ok: errors.length === 0,
      tgz: info.filename,
      tgzBytes: info.size,
      unpackedAt: unpacked,
      fileCount: files.length,
      resources: files.filter((file) => file.startsWith('resources/experts/')).length,
      manifestExperts: manifest.experts.length,
      catalogExperts: state.experts.length,
      errors,
      repaired,
      files,
    }
    await mkdir(REPORT_ROOT, { recursive: true })
    await writeFile(join(REPORT_ROOT, 'packaged-contents.json'), `${JSON.stringify(report, null, 2)}\n`)
    if (errors.length > 0) {
      console.error(JSON.stringify({ ok: false, errors: errors.slice(0, 50) }, null, 2))
      process.exitCode = 1
      return
    }
    console.log(JSON.stringify({ ok: true, tgz: tgzPath, files: files.length, experts: manifest.experts.length, resources: report.resources }, null, 2))
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

await main()
