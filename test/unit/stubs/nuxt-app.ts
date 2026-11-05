import { vi } from 'vitest'

/*
 * Заглушка Nuxt-алиаса `#app` для unit-тестов `plugin.client.ts` и `plugin.server.ts` (подключена через
 * vitest.config.ts): настоящий `#app` существует только внутри сборки Nuxt. Тест управляет runtimeConfig через
 * `nuxtStub.config`, смотрит на reload через `nuxtStub.reload`, на роутер — через `nuxtStub.router` (текущий маршрут
 * и `replace`; упавший переход — `failNavigation`), а на записи head, которые плагин кладёт через `useHead`, — через
 * `nuxtStub.head`.
 */

type NavigationErrorHandler = (error: unknown, to: { fullPath: string }) => void

/* Обработчики `router.onError`, которые повесил плагин: по одному на установку плагина (документ). */
const navigationErrorHandlers: NavigationErrorHandler[] = []

export const nuxtStub = {
  config: {
    app: { buildId: '', baseURL: '/' },
    public: { staleDeployGuard: { buildIdHeader: 'x-app-build-id', pollIntervalMs: 0 } },
  },
  reload: vi.fn<(options: unknown) => void>(),
  router: {
    currentRoute: { value: { path: '/', query: {} as Record<string, unknown>, hash: '' } },
    replace: vi.fn<(to: unknown) => Promise<void>>(() => Promise.resolve()),
    onError(handler: NavigationErrorHandler): void {
      navigationErrorHandlers.push(handler)
    },
  },
  head: vi.fn<(input: unknown) => void>(),
}

/* Заглушка defineNuxtPlugin отдаёт сам setup-колбэк — плагин вызывается как обычная функция. */
export function defineNuxtPlugin(setup: unknown): unknown {
  return setup
}

/* Переход на `fullPath` упал с `error`: так vue-router зовёт каждый обработчик `router.onError`. */
export function failNavigation(error: unknown, fullPath: string): void {
  for (const handler of navigationErrorHandlers) {
    handler(error, { fullPath })
  }
}

/* Документ выгружен: его обработчики роутера уходят вместе с ним. */
export function clearNavigationErrorHandlers(): void {
  navigationErrorHandlers.length = 0
}

export function reloadNuxtApp(options: unknown): void {
  nuxtStub.reload(options)
}

export function useRouter() {
  return nuxtStub.router
}

export function useHead(input: unknown): void {
  nuxtStub.head(input)
}

export function useRuntimeConfig() {
  return nuxtStub.config
}
