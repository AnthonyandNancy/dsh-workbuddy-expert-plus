/**
 * Same-origin HTTP surface for the Bot half.
 *
 * The browser sends only an expert id and the confirmed fields; the service
 * re-reads the Prompt, capability and read-only state before calling DS-Bot.
 * Requests are capped at 64 KiB and one create is accepted at a time.
 */

import { DsBotApiError, callDsBot } from '../adapters/dsbot-api.js'
import { probeDsBot } from '../adapters/environment.js'

export const ROUTE_BASE = '/dsh-workbuddy-expert-plus/api/bot'
const MAX_BODY_BYTES = 64 * 1024

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

async function readJsonBody(request, maxBytes = MAX_BODY_BYTES) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBytes) {
      const error = new Error('request body too large')
      error.code = 'BODY_TOO_LARGE'
      throw error
    }
    chunks.push(buffer)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('request body is not JSON')
    error.code = 'BODY_INVALID'
    throw error
  }
}

const STATUS = {
  EXPERT_NOT_FOUND: 404,
  PROMPT_HASH_MISMATCH: 409,
  PROMPT_ALTERED: 400,
  PROMPT_MISMATCH: 502,
  INVALID_FIELDS: 400,
  NAME_TAKEN: 409,
  READ_ONLY: 403,
  BUSY: 409,
  CREATE_UNCERTAIN: 409,
  INCOMPATIBLE: 424,
  INVALID_RESPONSE: 502,
  BODY_TOO_LARGE: 413,
  BODY_INVALID: 400,
}

/**
 * @param {object} hostCtx - context exposing webServer
 * @param {{service: object, probe?: Function, fetchImpl?: Function}} deps
 */
export function mountBotRoutes(hostCtx, { service, probe = probeDsBot, fetchImpl } = {}) {
  const disposers = []
  const register = (route) => {
    const off = hostCtx.webServer.register(route)
    if (typeof off === 'function') disposers.push(off)
  }

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/environment`,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' })
      try {
        sendJson(response, 200, await probe({ fetchImpl }))
      } catch (error) {
        sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
      }
    },
  })

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/bindings`,
    handler: async (request, response) => {
      if (request.method !== 'GET' && request.method !== 'HEAD') return sendJson(response, 405, { error: 'method not allowed' })
      try {
        sendJson(response, 200, { bindings: await service.bindings() })
      } catch (error) {
        const status = error?.code === 'READ_ONLY' ? 403 : STATUS[error?.code] ?? 502
        sendJson(response, status, { error: error instanceof Error ? error.message : String(error), ...(error?.code ? { code: error.code } : {}) })
      }
    },
  })

  register({
    kind: 'exact',
    path: `${ROUTE_BASE}/create`,
    handler: async (request, response) => {
      if (request.method !== 'POST') return sendJson(response, 405, { error: 'method not allowed' })
      if (!sameOrigin(request)) return sendJson(response, 403, { error: 'same-origin required' })
      let body
      try {
        body = await readJsonBody(request)
      } catch (error) {
        return sendJson(response, STATUS[error.code] ?? 400, { error: error.message, code: error.code })
      }
      if (body === null || typeof body !== 'object' || typeof body.expertId !== 'string' || body.expertId.trim() === '') {
        return sendJson(response, 400, { error: 'expertId is required', code: 'INVALID_FIELDS' })
      }
      try {
        const result = await service.create({
          expertId: body.expertId.trim(),
          name: body.name,
          role: body.role,
          instructions: body.instructions,
          model: body.model,
        }, { fetchImpl })
        sendJson(response, 200, result)
      } catch (error) {
        const status = error?.code === 'READ_ONLY' ? 403 : STATUS[error?.code] ?? (error instanceof DsBotApiError ? 502 : 500)
        sendJson(response, status, {
          error: error instanceof Error ? error.message : String(error),
          ...(error?.code ? { code: error.code } : {}),
        })
      }
    },
  })

  return () => { for (const off of disposers) off() }
}
