/**
 * Native DS-Bot Bot creation from a bundled expert.
 *
 * Order is strict: read+verify prompt → probe state → validate/read-only/dup
 * name → single-flight → exactly one create-bot → verify the bot in state →
 * persist the id mapping. Mapping is keyed by bot id, so a user rename keeps
 * the association; deletion prunes it. The service never edits DS-Bot state.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { DsBotApiError, callDsBot, normalizeState } from '../adapters/dsbot-api.js'
import { isBotNameTaken, toBotTemplate, validateBotFields, validateModel } from '../adapters/bot-template.js'

class BotServiceError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'BotServiceError'
    this.code = code
  }
}

const sha256 = async (text) => {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex')
}

async function readBindings(path) {
  if (path === undefined) return {}
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function writeBindings(path, bindings) {
  if (path === undefined) return
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(bindings, null, 2)}\n`, { mode: 0o600 })
  await rename(tmp, path)
}

export function createBotService({
  adapter,
  api = { call: (endpoint, payload, options) => callDsBot(endpoint, payload, options) },
  bindingsPath,
}) {
  let inFlight = false

  async function requireExpert(expertId) {
    const experts = await adapter.list()
    const expert = experts.find((entry) => entry.id === expertId)
    if (expert === undefined) throw new BotServiceError('EXPERT_NOT_FOUND', `unknown expert: ${String(expertId)}`)
    return expert
  }

  async function stateNow(options) {
    const raw = await api.call('state', undefined, options)
    try {
      return normalizeState(raw)
    } catch (error) {
      throw new BotServiceError('INCOMPATIBLE', error instanceof Error ? error.message : String(error))
    }
  }

  async function create(input, options = {}) {
    if (inFlight) throw new BotServiceError('BUSY', 'a Bot creation is already in progress')
    inFlight = true
    try {
      const expert = await requireExpert(input.expertId)
      const prompt = await adapter.readPrompt(expert.id)
      const roleHash = expert.files?.find((file) => file.path === 'role.md')?.sha256
      if (roleHash !== undefined && roleHash !== await sha256(prompt)) {
        throw new BotServiceError('PROMPT_HASH_MISMATCH', 'the bundled prompt does not match the catalog hash')
      }
      // When the user edited the prompt, the client must prove the edit began
      // from the exact bundled prompt. The baseline hash is checked against
      // the manifest, not trusted from the request.
      const editedInstructions = input.instructions === undefined ? prompt : String(input.instructions)
      if (editedInstructions !== prompt) {
        if (input.basePromptSha256 !== roleHash) {
          throw new BotServiceError('PROMPT_BASELINE_MISMATCH', 'edited instructions must start from the exact bundled prompt')
        }
      }

      const state = await stateNow(options)
      if (state.readOnly !== undefined && state.readOnly !== null && state.readOnly !== false) {
        throw new BotServiceError('READ_ONLY', `DS-Bot is read-only: ${typeof state.readOnly === 'string' ? state.readOnly : 'locked'}`)
      }

      const template = toBotTemplate(expert, prompt, state)
      const fields = validateBotFields({
        name: input.name ?? template.name,
        role: input.role ?? template.role,
        instructions: editedInstructions,
      })
      if (!fields.ok) throw new BotServiceError('INVALID_FIELDS', fields.errors.join('; '))
      if (isBotNameTaken(state, fields.name)) throw new BotServiceError('NAME_TAKEN', `A Bot named ${fields.name} already exists`)

      const requestedModel = input.model !== undefined ? input.model : template.model
      const modelVerdict = validateModel(requestedModel, state)
      if (!modelVerdict.ok) throw new BotServiceError('INVALID_FIELDS', modelVerdict.error)

      const payload = {
        name: fields.name,
        role: fields.role,
        instructions: editedInstructions,
        ...(modelVerdict.model === undefined ? {} : { model: modelVerdict.model }),
      }
      let bot
      try {
        bot = await api.call('create-bot', payload, options)
      } catch (error) {
        if (error?.code === 'TIMEOUT' || error?.code === 'NETWORK') {
          const recovered = await stateNow(options).catch(() => undefined)
          const found = recovered?.bots.find((entry) => entry.name === fields.name)
          if (found !== undefined) bot = found
          else throw new BotServiceError('CREATE_UNCERTAIN', 'The create request may have been submitted; refresh the Bot list before retrying')
        } else if (error?.code === 'READ_ONLY') {
          throw new BotServiceError('READ_ONLY', error.message)
        } else if (error instanceof BotServiceError) {
          throw error
        } else {
          throw new BotServiceError(error?.code ?? 'CREATE_FAILED', error instanceof Error ? error.message : String(error))
        }
      }
      if (bot === null || typeof bot !== 'object' || typeof bot.id !== 'string' || bot.id === '') {
        throw new BotServiceError('INVALID_RESPONSE', 'create-bot did not return a Bot id')
      }
      if (bot.instructions !== undefined && bot.instructions !== editedInstructions) {
        throw new BotServiceError('PROMPT_MISMATCH', 'DS-Bot stored instructions differ from the submitted prompt')
      }

      const after = await stateNow(options)
      const verified = after.bots.some((entry) => entry.id === bot.id)
      const bindings = await readBindings(bindingsPath)
      const list = Array.isArray(bindings[expert.id]) ? bindings[expert.id] : []
      if (!list.some((entry) => entry.botId === bot.id)) list.push({ botId: bot.id, name: bot.name, createdAt: new Date().toISOString() })
      bindings[expert.id] = list
      await writeBindings(bindingsPath, bindings)
      return { botId: bot.id, bot, verified, promptSha256: await sha256(editedInstructions) }
    } finally {
      inFlight = false
    }
  }

  async function bindings(options = {}) {
    const state = await stateNow(options)
    const live = new Set(state.bots.map((bot) => bot.id))
    const stored = await readBindings(bindingsPath)
    const pruned = {}
    for (const [expertId, list] of Object.entries(stored)) {
      if (!Array.isArray(list)) continue
      const kept = list.filter((entry) => entry !== null && typeof entry.botId === 'string' && live.has(entry.botId))
      if (kept.length > 0) pruned[expertId] = kept
    }
    if (bindingsPath !== undefined && JSON.stringify(pruned) !== JSON.stringify(stored)) await writeBindings(bindingsPath, pruned)
    return pruned
  }

  return { create, bindings }
}
