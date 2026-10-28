/**
 * Importer segment: the built-in expert market is the primary source; the
 * legacy WorkBuddy scanner remains an optional read-only extra. Both Agent
 * install and DS-Bot Bot creation are mounted behind the same services so the
 * client never talks to a filesystem or DS-Bot API directly.
 */

import { join } from 'node:path'

import { createBundledCatalog } from '../catalog/builtin.js'
import { createUnifiedCatalog } from '../catalog/unified.js'
import { createBundledSourceAdapter } from '../adapters/source.js'
import { createBotService } from '../services/create-bot.js'
import { createInstallService } from '../services/install-expert.js'
import { createCatalog } from './catalog.js'
import { mountBundledMarketRoutes } from './bundled-routes.js'
import { mountImporterRoutes } from './routes.js'
import { mountPagePolicy, mountVolatileWatch } from './settings.js'

/**
 * Mount the market: bundled catalog + legacy routes + optional local scanner.
 * @param {object} ctx - context exposing webServer + settings
 * @param {{config?: object, expertsRoot: string, dshHome?: string, ownersCtx?: object, ownerCtx?: object, pluginVersion?: string}} options
 * @returns {Promise<() => void>}
 */
export async function mountImporter(ctx, options = {}) {
  if (ctx.get('webServer') === undefined || ctx.get('settings') === undefined) {
    throw new Error('dsh-workbuddy-expert-plus importer requires the webServer and settings services')
  }
  const pluginVersion = options.pluginVersion ?? ''
  const bundled = createBundledCatalog({ pluginVersion })
  const bundledAdapter = createBundledSourceAdapter(bundled)
  const localCatalog = createCatalog()
  const catalog = createUnifiedCatalog({ bundled, local: localCatalog, localEnabled: false })

  const ownerCtx = options.ownerCtx ?? ctx
  const offWatch = mountVolatileWatch(ownerCtx, localCatalog)
  const offPolicy = mountPagePolicy(ctx, ownerCtx.fiber)

  const installer = options.expertsRoot === undefined
    ? undefined
    : createInstallService({
      adapter: bundledAdapter,
      expertsRoot: options.expertsRoot,
      pluginVersion,
    })

  const botBindingsPath = options.dshHome === undefined
    ? undefined
    : join(options.dshHome, 'workbuddy-expert-plus', 'bot-bindings.json')
  const botService = createBotService({ adapter: bundledAdapter, bindingsPath: botBindingsPath })

  const offBundledRoutes = mountBundledMarketRoutes(ctx, { catalog, installer, botService })
  // The legacy WorkBuddy read-only routes remain available as an optional
  // source; the built-in routes above are the mandatory surface.
  const offLegacyRoutes = mountImporterRoutes(ctx, {
    catalog: localCatalog,
    exporter: undefined,
    config: options.config,
  })

  return () => {
    offLegacyRoutes()
    offBundledRoutes()
    offPolicy()
    offWatch()
  }
}
