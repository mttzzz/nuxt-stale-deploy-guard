import { defineNuxtPlugin, reloadNuxtApp, useRouter, useRuntimeConfig } from '#app'

import { createChunkReloadGuard } from './chunk-reload-guard'
import { isDeadLoadHandled, readDeadLoadBridge, RETRY_MARKER_KEY } from './dead-load-bridge'
import { createSafeSessionStorage } from './safe-storage'
import { isStaleChunkError } from './stale-chunk'

/*
 * Клиентский Nuxt-плагин, оборачивающий чистый `createChunkReloadGuard` в реальные
 * хуки/события. Все каналы детекта stale-chunk идут через один guard — cooldown
 * и circuit-breaker одни на все источники.
 *
 * Reload — только по ДОКАЗАТЕЛЬСТВУ, что вкладка сломана (stale-chunk ошибка), плюс опциональный
 * poll с вердиктом «флот сошёлся». Пассивных триггеров (app:mounted, online, visibilitychange,
 * router.beforeEach) больше нет: они перезагружали РАБОТАЮЩУЮ вкладку при любой пробе с чужим id —
 * посреди чтения и набора текста, на каждой выкатке, а на возврате ноутбука из сна ещё и в окно
 * rolling-деплоя, где вердикт «хоть одна проба» ложный (ai.pushka.biz 09.09.2026, «чат вылетает»).
 * Старой вкладке с immutable-ассетами на CDN reload не нужен вовсе; о новой версии консьюмер
 * сообщает сам (Nuxt app:manifest:update → тост).
 *
 * Каждый канал передаёт в guard исходную ошибку (payload `vite:preloadError`, `reason`
 * `unhandledrejection`, `error ?? message` события `error`, ошибка `vue:error`/`app:error`, `error` из
 * `app:chunkError`): с ней guard шлёт событие `app:chunk-reload-blocked` на каждый исход «reload не
 * случится» — подробности в chunk-reload-guard.ts.
 *
 * Сбой чанка ДО `app:mounted` (pre-mount) ведёт не guard, а inline-скрипт `dead-load.ts` из head: мост
 * `window.__sdgDeadLoad` (`dead-load-bridge.ts`) принимает `fail('chunk', error)` из тех же каналов и решает
 * сразу, без HEAD-проб — автоповтор страницы с маркером `sdg-retry` либо экран «Страница не загрузилась».
 * Зачем: `nuxt:router` (enforce: 'pre') стартует первую навигацию раньше этого плагина, и транзитный сбой
 * первого чанка оставлял вкладку мёртвой на странице ошибки Nuxt. На `app:mounted` плагин сообщает мосту
 * `mounted()` и убирает из URL ключ `sdg-retry` (`router.replace`, прочие query и hash на месте); с этого
 * момента каналы работают как всегда — через guard. Нет моста (dev, старый HTML) — плагин как раньше.
 *
 * Документ, который УЖЕ пережил сбой (мост сообщил `handled()` — сделан автоповтор или показан экран
 * «Страница не загрузилась»), для плагина мёртв: все каналы молчат до конца жизни документа, `app:mounted`
 * не убирает маркер `sdg-retry` (кнопка «Обновить» на экране = одна попытка на нажатие), poll не вердиктит.
 * Зачем: уходящий документ ещё живёт секунды после автоповтора, и навигация обрывает загрузку CSS его
 * страницы ошибки — сбой доходит до guard уже ПОСЛЕ монтирования, прыгает «билд актуален» и шлёт ложный
 * `not-stale` (Sentry KP-MODMB-COM-1H, 21.10.2026).
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
  /* Мост inline-скрипта dead-load: есть только в проде. Нет моста — pre-mount ничем не отличается от post-mount. */
  const deadLoad = readDeadLoadBridge()
  let mounted = false

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

  /* Сбой чанка до app:mounted уходит inline-скрипту (повтор страницы или экран «не загрузилась»), guard тут
     не нужен: true — сбой передан. После монтирования и без моста — false, каналы идут прежним путём. */
  function handOverBeforeMount(error: unknown): boolean {
    if (!deadLoad || mounted) {
      return false
    }
    deadLoad.fail('chunk', error)
    return true
  }

  /* Документ уже пережил сбой (автоповтор сделан или показан экран «Страница не загрузилась»): с этого момента
     плагин молчит — иначе уходящий документ (навигация обрывает загрузку CSS его страницы ошибки) шлёт ложный
     «билд актуален»: Sentry KP-MODMB-COM-1H, 21.10.2026. Мост 0.6.0 без `handled` → false, поведение прежнее. */
  function deadLoadHandled(): boolean {
    return isDeadLoadHandled(deadLoad)
  }

  /* Страница загрузилась — маркер автоповтора в адресе больше не нужен. Убирается ТОЛЬКО ключ `sdg-retry`:
     прочие query и hash остаются. */
  async function dropRetryMarker(): Promise<void> {
    const route = router.currentRoute.value
    if (!(RETRY_MARKER_KEY in route.query)) {
      return
    }
    const query = Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== RETRY_MARKER_KEY))
    try {
      await router.replace({ path: route.path, query, hash: route.hash })
    } catch {
      /* Не вышло убрать маркер — косметика: страница уже загружена, он останется в адресе до следующей навигации. */
    }
  }

  nuxtApp.hook('app:chunkError', ({ error }) => {
    if (deadLoadHandled()) {
      return
    }
    if (handOverBeforeMount(error)) {
      return
    }
    void guard.verifyAndReload(undefined, error)
  })
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Nuxt hook API requires callback, not awaitable
  nuxtApp.hook('vue:error', (error) => {
    if (deadLoadHandled()) {
      return
    }
    if (isStaleChunkError(error) && handOverBeforeMount(error)) {
      return
    }
    guard.handleStaleChunkError(error)
  })
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Nuxt hook API requires callback, not awaitable
  nuxtApp.hook('app:error', (error) => {
    if (deadLoadHandled()) {
      return
    }
    if (isStaleChunkError(error) && handOverBeforeMount(error)) {
      return
    }
    guard.handleStaleChunkError(error)
  })
  nuxtApp.hook('app:mounted', () => {
    mounted = true
    if (!deadLoad) {
      return
    }
    /* Документ уже пережил сбой: экран «Страница не загрузилась» стоит, а маркер `sdg-retry` в адресе нужен —
       кнопка «Обновить» перезагружает страницу С маркером, одно нажатие = одна попытка. Убирать маркер и
       сообщать скрипту `mounted()` здесь нельзя. */
    if (deadLoadHandled()) {
      return
    }
    deadLoad.mounted()
    void dropRetryMarker()
  })

  globalThis.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    /* Vite кладёт ошибку в `event.payload` (не `detail`). */
    const error: unknown = 'payload' in event ? event.payload : undefined
    if (deadLoadHandled()) {
      return
    }
    if (handOverBeforeMount(error)) {
      return
    }
    void guard.verifyAndReload(undefined, error)
  })
  globalThis.addEventListener('unhandledrejection', (event) => {
    const { reason } = event as { reason?: unknown }
    if (!isStaleChunkError(reason)) {
      return
    }
    event.preventDefault()
    if (deadLoadHandled()) {
      return
    }
    if (handOverBeforeMount(reason)) {
      return
    }
    void guard.verifyAndReload(undefined, reason)
  })
  globalThis.addEventListener('error', (event) => {
    const errorLike = event as { error?: unknown; message?: unknown }
    const candidate: unknown = errorLike.error ?? errorLike.message
    if (!isStaleChunkError(candidate)) {
      return
    }
    event.preventDefault()
    if (deadLoadHandled()) {
      return
    }
    if (handOverBeforeMount(candidate)) {
      return
    }
    void guard.verifyAndReload(undefined, candidate)
  })

  /* Опциональный poll: единственный проактивный триггер. Вердикт — схождение флота (все пробы
     единогласно на одном чужом id), иначе в окне rolling вкладка на новом билде уезжала бы на
     старый. Дефолт 0 — выключен. */
  if (opts.pollIntervalMs > 0) {
    nuxtApp.hook('app:mounted', () => {
      globalThis.setInterval(() => {
        /* Документ, уже переживший сбой, poll не вердиктит: перезагрузка стёрла бы экран «Страница не
           загрузилась» и сломала контракт «одно нажатие = одна попытка». */
        if (deadLoadHandled()) {
          return
        }
        void guard.verifyConvergedAndReload(getCurrentLocationPath())
      }, opts.pollIntervalMs)
    })
  }
})
