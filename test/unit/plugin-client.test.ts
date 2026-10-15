// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import plugin from '../../src/runtime/plugin.client'
import { nuxtStub } from './stubs/nuxt-app'

/*
 * Клиентский плагин: каждый канал детекта (vite:preloadError, app:chunkError, unhandledrejection, error,
 * vue:error, app:error) обязан донести ИСХОДНУЮ ошибку до события `app:chunk-reload-blocked` — по ней
 * nuxt-sentry строит отчёт о проглоченном сбое. Плагин ставим один раз (он вешает слушатели на window), Nuxt
 * заменён заглушкой `#app` (vitest.config.ts). `buildId: ''` — самый короткий исход guard'а (`no-build-id`,
 * без проб и таймеров): тест проверяет проводку «канал → ошибка в detail», а не вердикты (они в
 * chunk-reload-guard.test.ts).
 */

type HookHandler = (...args: unknown[]) => unknown

interface FakeNuxtApp {
  hook: (name: string, handler: HookHandler) => void
}

const hooks = new Map<string, HookHandler>()
/* Detail каждого события `app:chunk-reload-blocked`, по порядку. */
const blocked: unknown[] = []

beforeAll(() => {
  /* Заглушка defineNuxtPlugin отдаёт сам setup-колбэк: плагин вызываем как обычную функцию. */
  const setup = plugin as unknown as (nuxtApp: FakeNuxtApp) => void
  setup({
    hook(name, handler) {
      hooks.set(name, handler)
    },
  })
  globalThis.addEventListener('app:chunk-reload-blocked', (event) => {
    blocked.push('detail' in event ? event.detail : undefined)
  })
})

beforeEach(() => {
  blocked.length = 0
})

function callHook(name: string, ...args: unknown[]) {
  const handler = hooks.get(name)
  if (!handler) {
    throw new Error(`плагин не зарегистрировал хук ${name}`)
  }
  return handler(...args)
}

/* Единственное ушедшее событие: его reason и исходная ошибка (по тождеству, не по содержимому). */
function onlyBlocked() {
  expect(blocked).toHaveLength(1)
  const [detail] = blocked
  if (typeof detail !== 'object' || detail === null) {
    throw new TypeError('detail события — не объект')
  }
  return {
    reason: 'reason' in detail ? detail.reason : undefined,
    error: 'error' in detail ? detail.error : undefined,
  }
}

const chunkError = new TypeError('Failed to fetch dynamically imported module: /_nuxt/invite.js')

describe('plugin.client — канал доносит исходную ошибку до app:chunk-reload-blocked', () => {
  it('vite:preloadError → event.payload (не detail)', () => {
    const event = new Event('vite:preloadError', { cancelable: true })
    Object.assign(event, { payload: chunkError })
    globalThis.dispatchEvent(event)
    expect(onlyBlocked().reason).toBe('no-build-id')
    expect(onlyBlocked().error).toBe(chunkError)
  })

  it('app:chunkError → error из { error }', () => {
    callHook('app:chunkError', { error: chunkError })
    expect(onlyBlocked().error).toBe(chunkError)
  })

  it('unhandledrejection → reason', () => {
    const event = new Event('unhandledrejection', { cancelable: true })
    Object.assign(event, { reason: chunkError })
    globalThis.dispatchEvent(event)
    expect(onlyBlocked().error).toBe(chunkError)
  })

  it('error → event.error', () => {
    globalThis.dispatchEvent(
      new ErrorEvent('error', { error: chunkError, message: chunkError.message, cancelable: true }),
    )
    expect(onlyBlocked().error).toBe(chunkError)
  })

  it('error без event.error (скрипт без деталей) → message', () => {
    globalThis.dispatchEvent(
      new ErrorEvent('error', { message: 'Importing a module script failed.', cancelable: true }),
    )
    expect(onlyBlocked().error).toBe('Importing a module script failed.')
  })

  it('vue:error → ошибка хука', () => {
    callHook('vue:error', chunkError)
    expect(onlyBlocked().error).toBe(chunkError)
  })

  it('app:error → ошибка хука', () => {
    callHook('app:error', chunkError)
    expect(onlyBlocked().error).toBe(chunkError)
  })
})

describe('plugin.client — preventDefault каналов не изменился', () => {
  it('vite:preloadError гасится ВСЕГДА, даже если payload не похож на stale-chunk', () => {
    const event = new Event('vite:preloadError', { cancelable: true })
    Object.assign(event, { payload: new Error('что-то совсем другое') })
    globalThis.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('unhandledrejection: stale-chunk гасится, прочее — нет и событий не рождает', () => {
    const stale = new Event('unhandledrejection', { cancelable: true })
    Object.assign(stale, { reason: chunkError })
    globalThis.dispatchEvent(stale)
    expect(stale.defaultPrevented).toBe(true)
    expect(blocked).toHaveLength(1)

    blocked.length = 0
    const other = new Event('unhandledrejection', { cancelable: true })
    Object.assign(other, { reason: new Error('Cannot read properties of undefined') })
    globalThis.dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
    expect(blocked).toHaveLength(0)
  })

  it('error: stale-chunk гасится, прочее — нет и событий не рождает', () => {
    const stale = new ErrorEvent('error', { error: chunkError, message: chunkError.message, cancelable: true })
    globalThis.dispatchEvent(stale)
    expect(stale.defaultPrevented).toBe(true)
    expect(blocked).toHaveLength(1)

    blocked.length = 0
    const other = new ErrorEvent('error', {
      error: new Error('Cannot read properties of undefined'),
      message: 'Cannot read properties of undefined',
      cancelable: true,
    })
    globalThis.dispatchEvent(other)
    expect(other.defaultPrevented).toBe(false)
    expect(blocked).toHaveLength(0)
  })

  it('исход «нет build-id» reload не запускает', () => {
    callHook('app:error', chunkError)
    expect(nuxtStub.reload).not.toHaveBeenCalled()
  })
})
