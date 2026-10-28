/**
 * Bounded DS-Bot capability probe.
 *
 * Call this only when a Bot entry/action needs it — never on page startup.
 * Distinguishes absent (404), transient/unknown (network, timeout, 5xx), auth
 * refusal, read-only and protocol incompatibility. A network error must never
 * be reinterpreted as "not installed".
 */

import { callDsBot, normalizeState } from './dsbot-api.js'

/** @returns {Promise<{status: 'absent'|'ready'|'readOnly'|'unknown'|'incompatible', state?: object, reason?: string}>} */
export async function probeDsBot({ fetchImpl = globalThis.fetch, signal, timeoutMs = 4_000 } = {}) {
  try {
    const value = await callDsBot('state', undefined, { fetchImpl, signal, timeoutMs })
    const state = normalizeState(value)
    if (state.readOnly !== undefined && state.readOnly !== null && state.readOnly !== false) {
      return { status: 'readOnly', state, reason: typeof state.readOnly === 'string' ? state.readOnly : 'DS-Bot is read-only' }
    }
    return { status: 'ready', state }
  } catch (error) {
    switch (error?.code) {
      case 'ABSENT': return { status: 'absent', reason: error.message }
      case 'READ_ONLY': return { status: 'readOnly', reason: error.message }
      case 'INCOMPATIBLE': return { status: 'incompatible', reason: error.message }
      case 'TIMEOUT':
      case 'NETWORK':
      case 'HTTP':
      case 'ABORTED': return { status: 'unknown', reason: error.message }
      default: return { status: 'unknown', reason: error instanceof Error ? error.message : String(error) }
    }
  }
}

/** The read-only surface hint; a hint only, never proof DS-Bot exists. */
export function readSurfaceHint(storage = globalThis.localStorage) {
  try {
    const value = storage.getItem('ds-bot:surface')
    return value === 'agent' || value === 'bot' ? value : 'unknown'
  } catch {
    return 'unknown'
  }
}
