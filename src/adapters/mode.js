/**
 * Agent/Bot operation state machine.
 *
 * Operation is derived from CAPABILITY first and the entry/surface only second.
 * A residual localStorage value can never turn an absent/unknown DS-Bot into
 * Bot creation, and a read-only Bot surface never silently degrades to install.
 */

export const OPERATION = Object.freeze({
  INSTALL: 'install',
  CREATE_BOT: 'createBot',
  DISABLED: 'disabled',
})

const BOT_ENTRIES = new Set(['botSidebar', 'botOverlay'])

/**
 * @param {{dsBot: string, surface?: string, reason?: string}} snapshot
 * @param {{entry?: string}} context
 * @param {string} [surfaceHint] client-side localStorage hint (untrusted)
 * @returns {{operation: string, reason?: string, entry?: string}}
 */
export function resolveOperation(snapshot, context = {}, surfaceHint) {
  const entry = context.entry ?? 'harnessSettings'
  const botEntry = BOT_ENTRIES.has(entry)
  const hintedBot = surfaceHint === 'bot' || snapshot?.surface === 'bot'

  if (snapshot?.dsBot === 'absent') {
    return { operation: OPERATION.INSTALL, entry: 'harnessSettings', reason: 'DS-Bot is not installed; DSH Agent install is available' }
  }
  if (snapshot?.dsBot === 'readOnly') {
    return { operation: OPERATION.DISABLED, entry, reason: snapshot.reason ?? 'DS-Bot is read-only; Bot creation is disabled' }
  }
  if (snapshot?.dsBot === 'incompatible') {
    return { operation: OPERATION.DISABLED, entry, reason: snapshot.reason ?? 'The installed DS-Bot API version is incompatible' }
  }
  if (snapshot?.dsBot === 'unknown') {
    return { operation: OPERATION.DISABLED, entry, reason: snapshot.reason ?? 'DS-Bot capability is unknown; refusing automatic mode changes' }
  }
  if (snapshot?.dsBot === 'ready') {
    if (botEntry && hintedBot) return { operation: OPERATION.CREATE_BOT, entry }
    if (entry === 'harnessSettings' && snapshot?.surface === 'agent') return { operation: OPERATION.INSTALL, entry }
    if (entry === 'harnessSettings' && snapshot?.surface === 'unknown') {
      return { operation: OPERATION.DISABLED, entry, reason: 'Current window surface is ambiguous; refresh before choosing an action' }
    }
    return { operation: OPERATION.CREATE_BOT, entry, reason: 'DS-Bot is ready' }
  }
  return { operation: OPERATION.DISABLED, entry, reason: 'Unrecognized DS-Bot capability state' }
}
