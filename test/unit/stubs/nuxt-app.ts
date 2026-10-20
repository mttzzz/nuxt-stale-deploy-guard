import { vi } from 'vitest'

/*
 * Заглушка Nuxt-алиаса `#app` для unit-тестов `plugin.client.ts` (подключена через vitest.config.ts):
 * настоящий `#app` существует только внутри сборки Nuxt. Тест управляет runtimeConfig через `nuxtStub.config`,
 * смотрит на reload через `nuxtStub.reload`, а на роутер — через `nuxtStub.router` (текущий маршрут и `replace`).
 */
export const nuxtStub = {
  config: {
    app: { buildId: '' },
    public: { staleDeployGuard: { buildIdHeader: 'x-app-build-id', pollIntervalMs: 0 } },
  },
  reload: vi.fn<(options: unknown) => void>(),
  router: {
    currentRoute: { value: { path: '/', query: {} as Record<string, unknown>, hash: '' } },
    replace: vi.fn<(to: unknown) => Promise<void>>(() => Promise.resolve()),
  },
}

/* Заглушка defineNuxtPlugin отдаёт сам setup-колбэк — плагин вызывается как обычная функция. */
export function defineNuxtPlugin(setup: unknown): unknown {
  return setup
}

export function reloadNuxtApp(options: unknown): void {
  nuxtStub.reload(options)
}

export function useRouter() {
  return nuxtStub.router
}

export function useRuntimeConfig() {
  return nuxtStub.config
}
