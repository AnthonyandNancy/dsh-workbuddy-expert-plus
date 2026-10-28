/**
 * Unified expert view: bundled first, optional local sources appended.
 *
 * Source collisions never silently overwrite: the bundled key stays distinct
 * and the local copy is returned under its own sourceKey.
 *
 * Reads resolve through the SAME merged table `stateOf()` exposes. A local
 * card that is listed must also be readable; an id no enabled source owns
 * fails closed instead of falling through to the wrong source.
 */

export function createUnifiedCatalog({ bundled, local, localEnabled = false }) {
  async function localStateOf() {
    if (!localEnabled || local === undefined || local === null) return { experts: [], warnings: [], enabled: false }
    try {
      const state = await local.stateOf()
      return { ...state, enabled: true }
    } catch (error) {
      return {
        experts: [],
        warnings: [`optional local source failed: ${error instanceof Error ? error.message : String(error)}`],
        enabled: true,
      }
    }
  }

  async function expertTable() {
    const primary = await bundled.stateOf()
    const experts = primary.experts.map((expert) => ({ ...expert }))
    const errors = [...(primary.errors ?? [])]
    const localState = await localStateOf()
    if (localEnabled && local !== undefined && local !== null) {
      const seen = new Set(experts.map((expert) => expert.sourceKey))
      for (const expert of localState.experts ?? []) {
        const key = expert.sourceKey ?? `workbuddy:${expert.pluginDir}:${expert.id}`
        if (seen.has(key)) continue
        seen.add(key)
        experts.push({ ...expert, sourceKind: 'workbuddy', sourceKey: key, agentInstalled: false, botCreated: false })
      }
    }
    return { primary, experts, errors, localState }
  }

  async function stateOf() {
    const { primary, experts, errors, localState } = await expertTable()
    return {
      ...primary,
      experts,
      errors,
      local: {
        enabled: localState.enabled,
        count: (localState.experts ?? []).length,
        warnings: localState.warnings ?? [],
      },
      counts: {
        ...primary.counts,
        bundled: primary.experts.length,
        local: (localState.experts ?? []).length,
        total: experts.length,
      },
    }
  }

  /**
   * Read from the source that owns one id in the merged table. Bundled wins
   * when both sources expose the same id, matching the market's display
   * order and never silently swapping bytes.
   */
  async function readFrom(name, id, ...args) {
    const { primary, localState } = await expertTable()
    if (primary.experts.some((expert) => expert.id === id)) {
      if (bundled === undefined || bundled === null || typeof bundled[name] !== 'function') {
        throw new Error(`bundled catalog does not implement ${name}()`)
      }
      return bundled[name](id, ...args)
    }
    if (localEnabled && local !== undefined && local !== null && (localState.experts ?? []).some((expert) => expert.id === id)) {
      if (typeof local[name] !== 'function') {
        throw new Error(`local catalog does not implement ${name}()`)
      }
      return local[name](id, ...args)
    }
    throw new Error(`unknown expert: ${String(id)}`)
  }

  return {
    stateOf,
    readPrompt: (id) => readFrom('readPrompt', id),
    readAsset: (id, relativePath) => readFrom('readAsset', id, relativePath),
    fingerprint: (id) => readFrom('fingerprint', id),
    find: (id) => readFrom('find', id),
    sourceRecord: (id) => readFrom('sourceRecord', id),
  }
}
