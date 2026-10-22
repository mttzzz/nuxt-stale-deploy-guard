import { runInThisContext } from 'node:vm'

import { vi } from 'vitest'

import { DEAD_LOAD_SCRIPT } from '../../../src/runtime/dead-load'
import { DEAD_LOAD_GLOBAL } from '../../../src/runtime/dead-load-bridge'
import plugin from '../../../src/runtime/plugin.client'
import { nuxtStub } from '../stubs/nuxt-app'

/*
 * Оснастка unit-тестов клиентского плагина и inline-скрипта «страница не загрузилась» (dead-load.ts):
 * сброс заглушек Nuxt (`#app`), установка плагина, шпионы на каналы window и запуск НАСТОЯЩЕГО текста
 * скрипта в окне теста — как браузер при парсинге head. Общая для plugin-client-dead-load.test.ts и
 * plugin-client-dead-load-handled.test.ts.
 */

export type HookHandler = (...args: unknown[]) => unknown

export interface FakeNuxtApp {
  hook: (name: string, handler: HookHandler) => void
}

export interface Installed {
  callHook: (name: string, ...args: unknown[]) => unknown
  /* Detail каждого события `app:chunk-reload-blocked`, по порядку. */
  blocked: unknown[]
}

export const chunkError = new TypeError('Failed to fetch dynamically imported module: /_nuxt/invite.js')
export const resolveError = new Error('Couldn\'t resolve component "default" at "/invite"')
/* Ошибка загрузки CSS страницы ошибки Nuxt — её обрывает навигация уходящего документа. */
export const cssError = new Error('Unable to preload CSS for /_nuxt/error-500.x.css')

const added: Parameters<typeof globalThis.addEventListener>[] = []

/* Сброс заглушек Nuxt + шпион на addEventListener: слушатели висят на window, их надо снять после теста. */
export function setupPluginDeadLoad(): void {
  nuxtStub.config.app.buildId = 'build-a'
  nuxtStub.config.public.staleDeployGuard.pollIntervalMs = 0
  nuxtStub.router.currentRoute.value = { path: '/invite/abc', query: {}, hash: '' }
  nuxtStub.router.replace.mockClear()
  nuxtStub.reload.mockClear()
  sessionStorage.clear()
  const original = globalThis.addEventListener.bind(globalThis)
  vi.spyOn(globalThis, 'addEventListener').mockImplementation((...args: Parameters<typeof original>) => {
    added.push(args)
    original(...args)
  })
}

export function teardownPluginDeadLoad(): void {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  for (const [type, listener, options] of added.splice(0)) {
    globalThis.removeEventListener(type, listener, options)
  }
  Reflect.deleteProperty(globalThis, DEAD_LOAD_GLOBAL)
  document.querySelector('[data-sdg-dead-load]')?.remove()
  Reflect.deleteProperty(globalThis.location, 'replace')
}

/* Мост `window.__sdgDeadLoad` без `handled()` — как у inline-скрипта 0.6.0 (старый кешированный HTML). */
export function createBridge() {
  const bridge = { fail: vi.fn<(kind: string, error?: unknown, url?: string) => void>(), mounted: vi.fn<() => void>() }
  Reflect.set(globalThis, DEAD_LOAD_GLOBAL, bridge)
  return bridge
}

export function install(): Installed {
  const hooks = new Map<string, HookHandler>()
  const blocked: unknown[] = []
  globalThis.addEventListener('app:chunk-reload-blocked', (event) => {
    blocked.push('detail' in event ? event.detail : undefined)
  })
  /* Заглушка defineNuxtPlugin отдаёт сам setup-колбэк: плагин вызываем как обычную функцию. */
  const setup = plugin as unknown as (nuxtApp: FakeNuxtApp) => void
  setup({
    hook(name, handler) {
      hooks.set(name, handler)
    },
  })
  return {
    blocked,
    callHook(name, ...args) {
      const handler = hooks.get(name)
      if (!handler) {
        throw new Error(`плагин не зарегистрировал хук ${name}`)
      }
      return handler(...args)
    },
  }
}

/* Сервер отвечает на HEAD-пробу build-id'ом `serverBuildId`: реальный `fetch` в тесте недопустим. */
export function stubServerBuildId(serverBuildId: string) {
  const probe = vi.fn((_url: string, _init?: unknown) =>
    Promise.resolve({ headers: { get: (name: string) => (name === 'x-app-build-id' ? serverBuildId : null) } }),
  )
  vi.stubGlobal('fetch', probe)
  return probe
}

export function preloadError(payload: unknown) {
  const event = new Event('vite:preloadError', { cancelable: true })
  Object.assign(event, { payload })
  globalThis.dispatchEvent(event)
  return event
}

export function unhandledRejection(reason: unknown) {
  const event = new Event('unhandledrejection', { cancelable: true })
  Object.assign(event, { reason })
  globalThis.dispatchEvent(event)
  return event
}

export function windowError(error: unknown, message: string) {
  const event = new ErrorEvent('error', { error, message, cancelable: true })
  globalThis.dispatchEvent(event)
  return event
}

/* Исполняем итоговый текст скрипта в окне теста — как браузер при парсинге head; location.replace — шпион. */
export function runScript(url: string) {
  globalThis.history.replaceState({}, '', url)
  const replace = vi.fn<(target: string) => void>()
  Object.defineProperty(globalThis.location, 'replace', { value: replace, configurable: true })
  runInThisContext(DEAD_LOAD_SCRIPT)
  return replace
}
