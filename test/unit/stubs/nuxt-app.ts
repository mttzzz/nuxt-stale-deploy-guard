import { vi } from 'vitest'

/*
 * Заглушка Nuxt-алиаса `#app` для unit-тестов `plugin.client.ts` (подключена через vitest.config.ts):
 * настоящий `#app` существует только внутри сборки Nuxt. Тест управляет runtimeConfig через `nuxtStub.config`
 * и смотрит на reload через `nuxtStub.reload`.
 */
export const nuxtStub = {
  config: {
    app: { buildId: '' },
    public: { staleDeployGuard: { buildIdHeader: 'x-app-build-id', pollIntervalMs: 0 } },
  },
  reload: vi.fn<(options: unknown) => void>(),
}

/* Заглушка defineNuxtPlugin отдаёт сам setup-колбэк — плагин вызывается как обычная функция. */
export function defineNuxtPlugin(setup: unknown): unknown {
  return setup
}

export function reloadNuxtApp(options: unknown): void {
  nuxtStub.reload(options)
}

export function useRuntimeConfig() {
  return nuxtStub.config
}
