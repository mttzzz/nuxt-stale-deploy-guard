import { defineNitroPlugin, getHeader, getRequestURL, setHeader, useRuntimeConfig } from 'nitropack/runtime'

import type { ResolvedModuleOptions } from '../types'

const NO_STORE_HTML = 'no-cache, no-store, must-revalidate'

function applyHeaders(event: Parameters<typeof getRequestURL>[0]) {
  const config = useRuntimeConfig(event)
  const opts = config.public.staleDeployGuard as ResolvedModuleOptions
  const buildId = typeof config.app.buildId === 'string' ? config.app.buildId : ''

  if (buildId) {
    setHeader(event, opts.buildIdHeader, buildId)
  }

  /*
   * Подстраховка к routeRules: если консьюмер где-то перетёр headers (handler пишет
   * setHeader позже), мы выставим no-store на HTML по Accept: text/html и на
   * serviceWorkerPath. Основной слой защиты всё ещё routeRules в module.ts.
   */
  const { pathname } = getRequestURL(event)
  const accept = getHeader(event, 'accept') ?? ''
  if (pathname === opts.serviceWorkerPath || accept.includes('text/html')) {
    setHeader(event, 'Cache-Control', NO_STORE_HTML)
  }
  if (pathname === opts.serviceWorkerPath) {
    setHeader(event, 'Service-Worker-Allowed', '/')
  }
}

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('request', (event) => {
    applyHeaders(event)
  })
  nitroApp.hooks.hook('beforeResponse', (event) => {
    applyHeaders(event)
  })
})
