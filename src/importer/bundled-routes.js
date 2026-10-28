/**
 * Bundled-market HTTP surface.
 *
 * The bundled catalog is the primary source. These routes expose summaries,
 * on-demand prompts/assets, the Agent install overlay, and the Bot capability
 * probe. A missing WorkBuddy directory is never an error and never empties the
 * market.
 */

import { sha256 } from '../catalog/resolver.js'
import { probeDsBot } from '../adapters/environment.js'
import { createBotRequestFetch } from '../adapters/request-fetch.js'

export const ROUTE_BASE = '/dsh-workbuddy-expert-plus/api/market'
const MAX_BODY_BYTES = 64 * 1024
const MAX_AVATAR_BYTES = 160_000

function sendJson(response, status, payload) {
  response.writeHead(status, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
  })
  response.end(JSON.stringify(payload))
}

function sameOrigin(request) {
  const host = request.headers?.host
  if (host !== undefined && !/^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(host)) return false
  if (request.headers?.['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers?.origin
  if (origin === undefined) return true
  try { return new URL(origin).host === host } catch { return false }
}

async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('request body too large'), { code: 'BODY_TOO_LARGE' })
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw Object.assign(new Error('invalid JSON body'), { code: 'BODY_INVALID' }) }
}

const STATUS = {
  CARD_NOT_FOUND: 404,
  FOLDER_EXISTS: 409,
  MANIFEST_BROKEN: 409,
  NOT_EXPORTED: 409,
  NOT_INSTALLED: 400,
  CARD_INVALID: 400,
  PROMPT_HASH_MISMATCH: 409,
  PROMPT_ALTERED: 400,
  INVALID_FIELDS: 400,
  NAME_TAKEN: 409,
  READ_ONLY: 403,
  BUSY: 409,
  CREATE_UNCERTAIN: 409,
  INCOMPATIBLE: 424,
  BODY_TOO_LARGE: 413,
  BODY_INVALID: 400,
}

/**
 * @param {object} hostCtx - exposes webServer
 * @param {{catalog: object, installer?: object, botService?: object, probe?: Function, botEnabled?: boolean}} deps
 */
export function mountBundledMarketRoutes(hostCtx, { catalog, installer, botService, probe = probeDsBot, botEnabled = true } = {}) {
  const disposers = []
  const webServer = hostCtx.webServer ?? hostCtx
  const register = (route) => {
    const off = webServer.register(route)
    if (typeof off === 'function') disposers.push(off)
  }
  let mutating = false

  function guard(request, response) {
    if (request.method !== 'POST') { sendJson(response, 405, { error: 'method not allowed' }); return false }
    if (!sameOrigin(request)) { sendJson(response, 403, { error: 'same-origin required' }); return false }
    if (mutating) { sendJson(response, 409, { error: 'another change is in progress', code: 'BUSY' }); return false }
    mutating = true
    return true
  }

  /**
   * The complete card table, install overlay and Bot bindings — the single
   * source used by both GET /state and every mutating route response.
   */
  async function currentState() {
    const bundled = await catalog.stateOf()
    let overlay = { installed: [], broken: [], orphans: [] }
    if (installer !== undefined) {
      try { overlay = await installer.overlay() } catch { /* overlay failure must not hide the catalog */ }
    }
    const installedById = new Map(overlay.installed.map((entry) => [entry.id, entry]))
    let bindings = {}
    if (botService !== undefined && botEnabled) {
      try { bindings = await botService.bindings() } catch { bindings = {} }
    }
    const experts = bundled.experts.map((expert) => {
      const installed = installedById.get(expert.id)
      const bots = Array.isArray(bindings[expert.id]) ? bindings[expert.id] : []
      return {
        ...expert,
        agentInstalled: installed !== undefined,
        installed: installed !== undefined,
        updatable: installed?.updatable === true,
        botCreated: bots.length > 0,
        createdBots: bots,
      }
    })
    return {
      bundleVersion: bundled.bundleVersion,
      pluginVersion: bundled.pluginVersion,
      sourceRevision: bundled.sourceRevision,
      counts: { ...bundled.counts, bundled: experts.length, total: experts.length },
      sourcePath: '',
      pathExists: true,
      revision: 0,
      experts,
      errors: bundled.errors,
      installed: overlay.installed,
      broken: overlay.broken,
      orphans: overlay.orphans,
      botEnabled,
      warnings: [],
    }
  }

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/state`,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' })
      try {
        sendJson(response, 200, await currentState())
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/refresh`,
    handler: async (request, response) => {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
      if (!sameOrigin(request)) return sendJson(response, 403, { error: 'same-origin required' })
      // The bundled manifest is immutable inside the installed package; a
      // refresh simply re-reads it (and the install overlay) without scanning
      // any WorkBuddy directory.
      try {
        sendJson(response, 200, await currentState())
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/prompt`,
    handler: async (request, response) => {
      if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' })
      const id = new URL(request.url ?? '/', 'http://internal.invalid').searchParams.get('id')
      if (typeof id !== 'string' || id === '') return sendJson(response, 400, { error: 'id is required' })
      try {
        const prompt = await catalog.readPrompt(id)
        // `contentSha256` on this route is the PROMPT baseline the client
        // sends back for an edited instruction. It must be the role.md byte
        // hash the create service compares against — the catalog's aggregate
        // `fingerprint()` is a different value (it covers every declared
        // file) and would reject every edited prompt.
        sendJson(response, 200, { id, prompt, contentSha256: sha256(Buffer.from(prompt, 'utf8')) })
      } catch (error) {
        sendJson(response, /unknown expert/.test(String(error?.message)) ? 404 : 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/avatar`,
    handler: async (request, response) => {
      if (request.method !== 'GET') return sendJson(response, 405, { error: 'method not allowed' })
      const id = new URL(request.url ?? '/', 'http://internal.invalid').searchParams.get('id')
      if (typeof id !== 'string' || id === '') return sendJson(response, 400, { error: 'id is required' })
      try {
        const expert = await catalog.find(id)
        if (expert === undefined || expert.avatarFile === undefined) return sendJson(response, 404, { error: 'not found' })
        const relativePath = expert.avatarFile.replace(`${expert.id}/`, '')
        const bytes = Buffer.from(await catalog.readAsset(id, relativePath))
        if (bytes.length > MAX_AVATAR_BYTES) return sendJson(response, 404, { error: 'not found' })
        const contentType = /\.png$/i.test(relativePath) ? 'image/png' : /\.webp$/i.test(relativePath) ? 'image/webp' : 'image/jpeg'
        response.writeHead(200, { 'content-type': contentType, 'cache-control': 'max-age=60', 'content-length': String(bytes.length) })
        response.end(bytes)
      } catch {
        sendJson(response, 404, { error: 'not found' })
      }
    },
  })

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/environment`,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' })
      if (!botEnabled) return sendJson(response, 200, { status: 'absent', reason: 'Bot integration is disabled' })
      try {
        sendJson(response, 200, await probe({ fetchImpl: createBotRequestFetch(request) }))
      } catch (error) {
        sendJson(response, 200, { status: 'unknown', reason: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  if (installer !== undefined) {
    const engine = (name, run) => register({
      kind: 'exact',
      path: `${ROUTE_BASE}/${name}`,
      handler: async (request, response) => {
        if (!guard(request, response)) return
        try {
          const body = await readJsonBody(request)
          if (body === null || typeof body !== 'object' || typeof body.id !== 'string') throw Object.assign(new Error('id is required'), { code: 'CARD_INVALID' })
          const result = await run(body.id)
          sendJson(response, 200, { ...result, state: await currentState() })
        } catch (error) {
          sendJson(response, STATUS[error?.code] ?? 400, { error: error instanceof Error ? error.message : String(error), ...(error?.code ? { code: error.code } : {}) })
        } finally { mutating = false }
      },
    })
    engine('install', (id) => installer.install(id))
    engine('update', (id) => installer.update(id))
    engine('uninstall', (id) => installer.uninstall(id))
  }

  if (botService !== undefined && botEnabled) {
    register({
      kind: 'exact',
      path: `${ROUTE_BASE}/bot/create`,
      handler: async (request, response) => {
        if (!guard(request, response)) return
        try {
          const body = await readJsonBody(request)
          if (body === null || typeof body !== 'object' || typeof body.expertId !== 'string') {
            throw Object.assign(new Error('expertId is required'), { code: 'INVALID_FIELDS' })
          }
          const result = await botService.create({
            expertId: body.expertId,
            name: body.name,
            role: body.role,
            instructions: body.instructions,
            basePromptSha256: body.basePromptSha256,
            model: body.model,
          }, { fetchImpl: createBotRequestFetch(request) })
          sendJson(response, 200, { ...result, state: await currentState() })
        } catch (error) {
          sendJson(response, STATUS[error?.code] ?? 400, {
            error: error instanceof Error ? error.message : String(error),
            ...(error?.code ? { code: error.code } : {}),
          })
        } finally { mutating = false }
      },
    })

    register({
      kind: 'exact',
      path: `${ROUTE_BASE}/bot/bindings`,
      handler: async (request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' })
        try {
          sendJson(response, 200, { bindings: await botService.bindings({ fetchImpl: createBotRequestFetch(request) }) })
        } catch (error) {
          sendJson(response, 502, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    })
  }

  return () => { for (const off of disposers) off() }
}
