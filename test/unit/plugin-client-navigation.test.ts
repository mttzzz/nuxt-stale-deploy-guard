// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHUNK_RELOAD_COOLDOWN_KEY } from '../../src/runtime/chunk-reload-guard'
import {
  chunkError,
  install,
  preloadError,
  resolveError,
  runScript,
  setupPluginDeadLoad,
  stubServerBuildId,
  teardownPluginDeadLoad,
} from './helpers/plugin-dead-load'
import { failNavigation, nuxtStub } from './stubs/nuxt-app'

/*
 * Клиентский плагин и `router.onError`: переход на маршрут, упавший на загрузке чанка, перезагружает вкладку на цель
 * перехода (Sentry AI-PUSHKA-BIZ-8Q, ai.pushka.biz 05.11.2026). Вердикты guard'а — chunk-reload-navigation.test.ts;
 * здесь — цепочка в плагине: каналы сбоя чанка, роутер, мост inline-скрипта и путь перезагрузки. Ошибки — в той форме,
 * в какой их видит плагин: `vite:preloadError` с TypeError импорта и отказ перехода `Couldn't resolve component`
 * (Vite-хелпер после preventDefault отдаёт `undefined`).
 */

beforeEach(() => {
  setupPluginDeadLoad()
})

afterEach(() => {
  vi.useRealTimers()
  teardownPluginDeadLoad()
})

describe('plugin.client — переход, упавший на чанке', () => {
  it('8Q: сбой prefetch — not-stale без reload; переход по ссылке — reload на цель, второй вердикт не уходит', async () => {
    stubServerBuildId('build-a')
    vi.useFakeTimers()
    const page = install()
    page.callHook('app:mounted')

    preloadError(chunkError)
    await vi.advanceTimersByTimeAsync(5000)

    expect(page.blocked).toEqual([
      {
        reason: 'not-stale',
        error: chunkError,
        probes: ['build-a', 'build-a', 'build-a', 'build-a'],
        buildId: 'build-a',
      },
    ])
    expect(nuxtStub.reload).not.toHaveBeenCalled()

    /* Клик: упавший импорт снова роняет `vite:preloadError`, переход падает `Couldn't resolve component`. */
    preloadError(chunkError)
    failNavigation(resolveError, '/updates?tab=all')
    await vi.advanceTimersByTimeAsync(5000)

    expect(nuxtStub.reload).toHaveBeenCalledExactlyOnceWith({
      path: '/updates?tab=all',
      force: true,
      persistState: true,
    })
    expect(page.blocked).toHaveLength(1)
  })

  it('путь перезагрузки — с baseURL приложения, как у штатного reload Nuxt', () => {
    nuxtStub.config.app.baseURL = '/app/'
    const page = install()
    page.callHook('app:mounted')

    failNavigation(resolveError, '/updates')

    expect(nuxtStub.reload).toHaveBeenCalledExactlyOnceWith({ path: '/app/updates', force: true, persistState: true })
  })

  it('переход упал не на чанке — плагин его не трогает', () => {
    const page = install()
    page.callHook('app:mounted')

    failNavigation(new Error('middleware: доступ запрещён'), '/admin')

    expect(nuxtStub.reload).not.toHaveBeenCalled()
    expect(page.blocked).toEqual([])
  })

  it('вкладку только что перезагрузил guard — упавший переход приходит событием cooldown, второго reload нет', () => {
    sessionStorage.setItem(CHUNK_RELOAD_COOLDOWN_KEY, String(Date.now() - 1000))
    const page = install()
    page.callHook('app:mounted')

    failNavigation(resolveError, '/updates')

    expect(nuxtStub.reload).not.toHaveBeenCalled()
    expect(page.blocked).toEqual([{ reason: 'cooldown', error: resolveError, buildId: 'build-a' }])
  })
})

describe('plugin.client — упавший переход до монтирования и на документе, пережившем сбой', () => {
  it('до app:mounted переход уходит inline-скрипту: автоповтор текущей страницы, guard не перезагружает', () => {
    const replace = runScript('/invite/abc')
    const page = install()

    failNavigation(resolveError, '/invite/abc')

    expect(replace).toHaveBeenCalledExactlyOnceWith(`${globalThis.location.origin}/invite/abc?sdg-retry=chunk`)
    expect(nuxtStub.reload).not.toHaveBeenCalled()
    expect(page.blocked).toEqual([])
  })

  it('после автоповтора документ молчит: упавший переход не даёт второй перезагрузки', () => {
    const replace = runScript('/invite/abc')
    const page = install()
    preloadError(chunkError)

    failNavigation(resolveError, '/invite/abc')

    expect(replace).toHaveBeenCalledOnce()
    expect(nuxtStub.reload).not.toHaveBeenCalled()
    expect(page.blocked).toEqual([])
  })
})
