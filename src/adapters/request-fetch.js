/**
 * Bridge DS-Bot's POST api/bot call through DSH's own shared /api handler.
 *
 * The incoming browser request has already passed DSH's Host/Origin fence and
 * carries the signed browser credential. `connection.admit()` returns the
 * owner Peer for that credential; handing it to the shared Fetch handler is
 * the same path the browser's own /api call takes. Nothing is sent over a
 * network: the internal URL only supplies the pathname the handler reads, and
 * browser credentials never leave their own authority.
 */

const INTERNAL_API_BOT = 'http://dsh.inprocess/api/bot'
const ALLOWED_INIT_HEADERS = new Set(['content-type', 'accept'])

function bridgeError(code, message) {
  return Object.assign(new Error(message), { code })
}

/** Node repeats some headers as arrays; DSH reads string values only. */
function normalizeHeaders(headers) {
  const out = {}
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (typeof value === 'string') out[name] = value
    else if (Array.isArray(value)) out[name] = value.join(', ')
  }
  return out
}

/**
 * @param {{connection: object, request: object, peer?: object}} options
 * @returns {(input: string, init?: object) => Promise<Response>}
 */
export function createBotRequestFetch({ connection, request, peer } = {}) {
  let createSharedFetchHandler
  try {
    createSharedFetchHandler = connection?.createSharedFetchHandler
  } catch (error) {
    throw bridgeError('BRIDGE_UNAVAILABLE', `DSH connection is not readable: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (typeof createSharedFetchHandler !== 'function') {
    throw bridgeError('BRIDGE_UNAVAILABLE', 'DSH connection cannot bridge api/bot in-process; upgrade DSH Web')
  }
  let admitted = peer
  if (admitted === undefined) {
    let admit
    try {
      admit = connection?.admit
    } catch (error) {
      throw bridgeError('BRIDGE_UNAVAILABLE', `DSH connection is not readable: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (typeof admit !== 'function') {
      throw bridgeError('BRIDGE_UNAVAILABLE', 'DSH connection cannot bridge api/bot in-process; upgrade DSH Web')
    }
    const admission = admit.call(connection, { headers: normalizeHeaders(request?.headers) })
    if (admission === null || typeof admission !== 'object' || !('peer' in admission)) {
      const rejection = admission?.rejection
      throw bridgeError('TRUST_REQUIRED', `DSH rejected the request (${String(rejection ?? 'no peer')})`)
    }
    admitted = admission.peer
  }
  const handler = createSharedFetchHandler.call(connection, '/api')
  if (handler === null || typeof handler?.fetch !== 'function') {
    throw bridgeError('BRIDGE_UNAVAILABLE', 'DSH shared /api handler is unavailable')
  }
  return async (_input, init = {}) => {
    const headers = {}
    for (const [name, value] of Object.entries(init.headers ?? {})) {
      if (typeof value !== 'string') continue
      if (ALLOWED_INIT_HEADERS.has(name.toLowerCase())) headers[name.toLowerCase()] = value
    }
    const bridged = new Request(INTERNAL_API_BOT, {
      method: init.method ?? 'POST',
      headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(init.signal === undefined ? {} : { signal: init.signal }),
    })
    const response = await handler.fetch(bridged, admitted)
    if (!(response instanceof Response)) {
      throw bridgeError('INCOMPATIBLE', 'DSH shared /api handler did not return a Response')
    }
    return response
  }
}
