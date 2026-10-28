/**
 * The ONLY place that speaks DS-Bot's POST api/bot protocol.
 *
 * This is an internal, versioned client protocol, not a public SDK. Call
 * shapes are validated on every response and every failure is normalized to a
 * typed code so the services can distinguish absent, incompatible, read-only,
 * transient and network-uncertain outcomes.
 */

export const DSBOT_ENDPOINT = 'api/bot'
export const DEFAULT_TIMEOUT_MS = 8_000

export class DsBotApiError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DsBotApiError'
    this.code = code
    this.details = details
  }
}

/**
 * Call one endpoint with cancellation and timeout.
 * @param {(input: string, init: object) => Promise<Response>} fetchImpl
 */
export async function callDsBot(endpoint, payload, { fetchImpl = globalThis.fetch, signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (typeof fetchImpl !== 'function') throw new DsBotApiError('NETWORK', 'fetch is unavailable')
  const controller = new AbortController()
  const onAbort = () => controller.abort(signal?.reason)
  if (signal !== undefined) {
    if (signal.aborted) controller.abort(signal.reason)
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs)
  try {
    const response = await fetchImpl(DSBOT_ENDPOINT, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint, payload: payload ?? null }),
      signal: controller.signal,
    })
    if (response.status === 404) throw new DsBotApiError('ABSENT', 'DS-Bot api/bot route is not present')
    if (response.status === 401 || response.status === 403) throw new DsBotApiError('READ_ONLY', `DS-Bot refused access (HTTP ${response.status})`)
    if (!response.ok) throw new DsBotApiError('HTTP', `DS-Bot HTTP ${response.status}`, { status: response.status })
    let result
    try { result = await response.json() } catch { throw new DsBotApiError('INCOMPATIBLE', 'DS-Bot response is not JSON') }
    if (result === null || typeof result !== 'object' || typeof result.ok !== 'boolean') {
      throw new DsBotApiError('INCOMPATIBLE', 'DS-Bot response does not carry an ok boolean')
    }
    if (!result.ok) {
      const code = typeof result.error?.code === 'string' ? result.error.code : 'REFUSED'
      const message = typeof result.error?.message === 'string' ? result.error.message : 'DS-Bot request failed'
      if (code === 'bot/read-only') throw new DsBotApiError('READ_ONLY', message, { code })
      throw new DsBotApiError('REFUSED', message, { code })
    }
    return result.value
  } catch (error) {
    if (error instanceof DsBotApiError) throw error
    if (error?.name === 'AbortError') {
      if (controller.signal.reason instanceof Error && controller.signal.reason.message === 'timeout') {
        throw new DsBotApiError('TIMEOUT', 'DS-Bot request timed out')
      }
      throw new DsBotApiError('ABORTED', 'DS-Bot request was cancelled')
    }
    throw new DsBotApiError('NETWORK', `Could not reach DS-Bot: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
    if (signal !== undefined) signal.removeEventListener?.('abort', onAbort)
  }
}

/** Validate the subset of `state` this plugin relies on. */
export function normalizeState(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new DsBotApiError('INCOMPATIBLE', 'DS-Bot state is not an object')
  }
  if (!Array.isArray(value.bots)) throw new DsBotApiError('INCOMPATIBLE', 'DS-Bot state.bots is not an array')
  return {
    bots: value.bots.filter((bot) => bot !== null && typeof bot === 'object' && typeof bot.id === 'string'),
    models: Array.isArray(value.models) ? value.models.filter((model) => model !== null && typeof model === 'object' && typeof model.ref === 'string') : [],
    defaultModel: typeof value.defaultModel === 'string' ? value.defaultModel : undefined,
    readOnly: value.readOnly ?? undefined,
  }
}
