/**
 * Unified expert view: bundled first, optional local sources appended.
 *
 * Source collisions never silently overwrite: the bundled key stays distinct
 * and the local copy is returned under its own sourceKey.
 */

export function createUnifiedCatalog({ bundled, local, localEnabled = false }) {
  async function stateOf() {
    const primary = await bundled.stateOf()
    const experts = primary.experts.map((expert) => ({ ...expert }))
    const errors = [...(primary.errors ?? [])]
    let localState = { experts: [], warnings: [], enabled: false }
    if (localEnabled && local !== undefined) {
      try {
        localState = { ...(await local.stateOf()), enabled: true }
        const seen = new Set(experts.map((expert) => expert.sourceKey))
        for (const expert of localState.experts ?? []) {
          const key = expert.sourceKey ?? `workbuddy:${expert.pluginDir}:${expert.id}`
          if (seen.has(key)) continue
          seen.add(key)
          experts.push({ ...expert, sourceKind: 'workbuddy', sourceKey: key, agentInstalled: false, botCreated: false })
        }
      } catch (error) {
        localState = { experts: [], warnings: [`optional local source failed: ${error instanceof Error ? error.message : String(error)}`], enabled: true }
      }
    }
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
  // The market routes, installer and Bot service all read through this
  // facade. Forward every read to the bundled catalog so a prompt/asset goes
  // through the same manifest hash verification as a direct bundled read;
  // an absent implementation is a programming error, never a silent empty
  // prompt.
  function bundledRead(name, ...args) {
    if (bundled === undefined || bundled === null || typeof bundled[name] !== 'function') {
      throw new Error(`bundled catalog does not implement ${name}()`)
    }
    return bundled[name](...args)
  }

  return {
    stateOf,
    readPrompt: (id) => bundledRead('readPrompt', id),
    readAsset: (id, relativePath) => bundledRead('readAsset', id, relativePath),
    fingerprint: (id) => bundledRead('fingerprint', id),
    find: (id) => bundledRead('find', id),
    sourceRecord: (id) => bundledRead('sourceRecord', id),
  }
}
