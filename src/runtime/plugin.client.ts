import { defineNuxtPlugin, reloadNuxtApp, useRouter, useRuntimeConfig } from '#app'

import { createChunkReloadGuard } from './chunk-reload-guard'
import { createSafeSessionStorage } from './safe-storage'
import { isStaleChunkError } from './stale-chunk'

/*
 * Клиентский Nuxt-плагин, оборачивающий чистый `createChunkReloadGuard` в реальные
 * хуки/события. Все каналы детекта stale-chunk идут через один guard — cooldown
 * и circuit-breaker одни на все источники.
 *
 * Build-id берём из `runtimeConfig.app.buildId` (Nuxt автогенерит).
 * Server build-id фетчим HEAD-запросом по текущему URL и читаем header
 * (имя из `runtimeConfig.public.staleDeployGuard.buildIdHeader`).
 */

function getCurrentLocationPath(): string {
  return `${globalThis.location.pathname}${globalThis.location.search}`
}

function makeFetchServerBuildId(headerName: string) {
  return async (path: string, attempt = 0): Promise<string> => {
    const target = path || getCurrentLocationPath()
    const probeUrl = new URL(target, globalThis.location.origin)
    /* Cache-buster per-проба: исключает переиспользование ответа любым промежуточным кэшем —
       мульти-проба обязана реально дойти до сервера (и балансировщик раскидает по подам). */
    probeUrl.searchParams.set('sdg-probe', `${Date.now()}-${attempt}`)
    const url = probeUrl.toString()
    const common = {
      cache: 'no-store' as const,
      credentials: 'same-origin' as const,
      headers: { 'cache-control': 'no-cache', pragma: 'no-cache' },
    }
    try {
      const response = await globalThis.fetch(url, { method: 'HEAD', ...common })
      const id = response.headers.get(headerName)?.trim() ?? ''
      if (id) {
        return id
      }
    } catch {
      /* Fallthrough → GET */
    }
    try {
      const response = await globalThis.fetch(url, {
        ...common,
        headers: { ...common.headers, accept: 'text/html' },
      })
      return response.headers.get(headerName)?.trim() ?? ''
    } catch {
      return ''
    }
  }
}

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig()
  const opts = config.public.staleDeployGuard!
  const router = useRouter()

  const guard = createChunkReloadGuard({
    getBuildId: () => (typeof config.app.buildId === 'string' ? config.app.buildId : ''),
    reload: () => {
      reloadNuxtApp({ force: true, persistState: true })
    },
    fetchServerBuildId: makeFetchServerBuildId(opts.buildIdHeader),
    now: () => Date.now(),
    /* `createSafeSessionStorage()` — wrapper, защищающий от SecurityError при
     * доступе к sessionStorage в restricted-браузерах (Telegram WebView и т.п.).
     * Раньше тут был прямой `sessionStorage`, который throw'ил синхронно при
     * инициализации плагина и валил публичные страницы консьюмеров (KP-MODMB-COM-K). */
    storage: createSafeSessionStorage(),
    dispatchBlocked: (detail) => {
      globalThis.dispatchEvent(new CustomEvent('app:chunk-reload-blocked', { detail }))
    },
  })

  nuxtApp.hook('app:chunkError', () => {
    void guard.verifyAndReload()
  })
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Nuxt hook API requires callback, not awaitable
  nuxtApp.hook('vue:error', (error) => {
    guard.handleStaleChunkError(error)
  })
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Nuxt hook API requires callback, not awaitable
  nuxtApp.hook('app:error', (error) => {
    guard.handleStaleChunkError(error)
  })

  globalThis.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    void guard.verifyAndReload()
  })
  globalThis.addEventListener('unhandledrejection', (event) => {
    const { reason } = event as { reason?: unknown }
    if (!isStaleChunkError(reason)) {
      return
    }
    event.preventDefault()
    void guard.verifyAndReload()
  })
  globalThis.addEventListener('error', (event) => {
    const errorLike = event as { error?: unknown; message?: unknown }
    const candidate: unknown = errorLike.error ?? errorLike.message
    if (!isStaleChunkError(candidate)) {
      return
    }
    event.preventDefault()
    void guard.verifyAndReload()
  })

  router.beforeEach((to, from) => {
    if (to.fullPath !== from.fullPath) {
      void guard.verifyAndReload(to.fullPath)
    }
  })

  nuxtApp.hook('app:mounted', () => {
    void guard.verifyAndReload(getCurrentLocationPath())

    globalThis.addEventListener('online', () => {
      void guard.verifyAndReload(getCurrentLocationPath())
    })
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void guard.verifyAndReload(getCurrentLocationPath())
      }
    })
    if (opts.pollIntervalMs > 0) {
      globalThis.setInterval(() => {
        void guard.verifyAndReload(getCurrentLocationPath())
      }, opts.pollIntervalMs)
    }
  })
})
