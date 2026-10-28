/**
 * Build a host-side fetch for DS-Bot's browser route.
 *
 * DS-Bot exposes `api/bot` as a same-origin browser endpoint and authenticates
 * with the browser's session cookie. A Node service cannot use the relative
 * URL directly, so this helper turns the incoming plugin request into an
 * absolute loopback URL and forwards only the auth headers (never logs them).
 */

const LOOPBACK = /^(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i
const FORWARDED_HEADERS = ['cookie', 'authorization']

export function isLoopbackAuthority(host) {
  return typeof host === 'string' && LOOPBACK.test(host)
}

/**
 * @param {object} request - IncomingMessage-like request carrying headers
 * @param {{fallbackBase?: string, fetchImpl?: Function}} [options]
 * @returns {(input: string, init: object) => Promise<Response>}
 */
export function createBotRequestFetch(request, { fallbackBase = process.env.DSH_WEB_URL, fetchImpl = globalThis.fetch } = {}) {
  let base = fallbackBase
  const host = request?.headers?.host
  if (host !== undefined) {
    if (!isLoopbackAuthority(host)) {
      throw Object.assign(new Error('DS-Bot requests require a loopback Host'), { code: 'INCOMPATIBLE' })
    }
    const forwardedProto = String(request?.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase()
    const protocol = forwardedProto === 'https' ? 'https' : 'http'
    base = `${protocol}://${host}/`
  }
  if (typeof base !== 'string' || base.trim() === '') {
    throw Object.assign(new Error('cannot resolve the DS-Bot route origin'), { code: 'INCOMPATIBLE' })
  }
  let target
  try {
    target = new URL('api/bot', base.endsWith('/') ? base : `${base}/`)
  } catch {
    throw Object.assign(new Error('cannot resolve the DS-Bot route origin'), { code: 'INCOMPATIBLE' })
  }
  if (!isLoopbackAuthority(target.host)) {
    throw Object.assign(new Error('DS-Bot route origin is not loopback'), { code: 'INCOMPATIBLE' })
  }
  const forwarded = {}
  for (const name of FORWARDED_HEADERS) {
    const value = request?.headers?.[name]
    if (typeof value === 'string' && value !== '') forwarded[name] = value
  }
  return async (_input, init = {}) => fetchImpl(target.href, {
    ...init,
    headers: { ...(init.headers ?? {}), ...forwarded },
  })
}
