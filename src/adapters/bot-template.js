/**
 * Map a bundled expert onto DS-Bot's create-bot fields.
 * The complete role prompt is passed through unchanged; only duplicate-name
 * discovery and safe model selection are added.
 */

export const MAX_BOT_NAME = 40
export const MAX_BOT_ROLE = 24

export function validateBotFields({ name, role, instructions }) {
  const errors = []
  const cleanName = String(name ?? '').trim()
  const cleanRole = String(role ?? '').trim()
  if (cleanName === '') errors.push('name is required')
  if (cleanName.length > MAX_BOT_NAME) errors.push(`name must be at most ${MAX_BOT_NAME} characters`)
  if (/[@`\r\n]/.test(cleanName)) errors.push('name cannot contain @, backtick, or line breaks')
  if (['all', 'everyone', '所有人', '全体', 'user', 'you'].includes(cleanName.toLowerCase())) errors.push('name is reserved for group/user addressing')
  if (cleanRole.length > MAX_BOT_ROLE) errors.push(`role must be at most ${MAX_BOT_ROLE} characters`)
  if (typeof instructions !== 'string' || instructions.trim() === '') errors.push('instructions must be a non-empty prompt')
  return { ok: errors.length === 0, errors, name: cleanName, role: cleanRole }
}

export function toBotTemplate(expert, prompt, state = {}) {
  const profession = String(expert.profession ?? '').trim()
  const name = String(expert.displayName ?? '').trim().slice(0, MAX_BOT_NAME)
  const role = (profession || String(expert.description ?? '')).trim().slice(0, MAX_BOT_ROLE)
  const modelRefs = new Set((state.models ?? []).map((model) => model.ref))
  const model = typeof state.defaultModel === 'string' && modelRefs.has(state.defaultModel)
    ? state.defaultModel
    : state.models?.find((entry) => modelRefs.has(entry.ref))?.ref
  return {
    name,
    role,
    instructions: String(prompt ?? ''),
    ...(model === undefined ? {} : { model }),
  }
}

/** True when DS-Bot already uses the exact (trimmed) name. */
export function isBotNameTaken(state, name) {
  const normalized = String(name ?? '').trim()
  return (state?.bots ?? []).some((bot) => String(bot.name ?? '').trim() === normalized)
}
