// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEAD_LOAD_GLOBAL, SSR_MARKER_ATTR } from '../../src/runtime/dead-load-bridge'
import {
  cssError,
  install,
  preloadError,
  resolveError,
  runScript,
  setupPluginDeadLoad,
  stubServerBuildId,
  teardownPluginDeadLoad,
} from './helpers/plugin-dead-load'
import { nuxtStub } from './stubs/nuxt-app'

/*
 * Документ, отрендеренный на сервере (метка `data-sdg-ssr` на <html>), глазами клиентского плагина: сбой до монтирования
 * плагин по-прежнему отдаёт inline-скрипту, скрипт молча поглощает его (ни оверлея, ни replace, ни события) и помечает
 * документ пережившим сбой — а значит, плагин молчит до конца жизни документа: ни HEAD-проб, ни reload, ни `not-stale`.
 * Документ с меткой, который смонтировался без сбоев, живёт как любой другой. Оснастка (установка плагина, шпионы,
 * запуск настоящего текста скрипта) — helpers/plugin-dead-load.ts; метка ставится на <html> ДО запуска скрипта.
 */

beforeEach(() => {
  setupPluginDeadLoad()
  /* Виртуальные часы: серия проб guard'а — 4 запроса с паузой 400 мс, под виртуальными часами они догоняются сразу. */
  vi.useFakeTimers()
  document.documentElement.setAttribute(SSR_MARKER_ATTR, '')
})

afterEach(() => {
  vi.useRealTimers()
  teardownPluginDeadLoad()
  document.documentElement.removeAttribute(SSR_MARKER_ATTR)
})

function deadLoadScreen() {
  return document.querySelector('[data-sdg-dead-load]')
}

describe('SSR-документ и клиентский плагин', () => {
  it('сбой до монтирования (app:error) → скрипт поглощает молча: ни replace, ни экрана, ни проб, ни событий', async () => {
    const replace = runScript('/invite/abc?x=1')
    const probe = stubServerBuildId('build-a')
    const { callHook, blocked } = install()

    callHook('app:error', resolveError)
    await vi.advanceTimersByTimeAsync(5000)

    expect(replace).not.toHaveBeenCalled()
    expect(deadLoadScreen()).toBeNull()
    expect(probe).not.toHaveBeenCalled()
    expect(nuxtStub.reload).not.toHaveBeenCalled()
    expect(blocked).toEqual([])
  })

  it('то же на URL, где уже есть sdg-retry: экрана «Страница не загрузилась» и события retry-failed нет', () => {
    const replace = runScript('/invite/abc?sdg-retry=chunk')
    const { callHook, blocked } = install()

    callHook('app:error', resolveError)

    expect(replace).not.toHaveBeenCalled()
    expect(deadLoadScreen()).toBeNull()
    expect(blocked).toEqual([])
  })

  it('документ, поглотивший сбой, для плагина мёртв: после app:mounted сбой не даёт ни проб, ни событий, маркер не трогается', async () => {
    runScript('/invite/abc?sdg-retry=chunk')
    nuxtStub.router.currentRoute.value = { path: '/invite/abc', query: { 'sdg-retry': 'chunk' }, hash: '' }
    const probe = stubServerBuildId('build-a')
    const bridge = Reflect.get(globalThis, DEAD_LOAD_GLOBAL) as { mounted: () => void }
    const mountedSpy = vi.spyOn(bridge, 'mounted')
    const { callHook, blocked } = install()

    callHook('app:error', resolveError)
    callHook('app:mounted')
    const event = preloadError(cssError)
    await vi.advanceTimersByTimeAsync(5000)

    expect(event.defaultPrevented).toBe(true)
    expect(mountedSpy).not.toHaveBeenCalled()
    expect(nuxtStub.router.replace).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(nuxtStub.reload).not.toHaveBeenCalled()
    expect(blocked).toEqual([])
  })

  it('метка есть, сбоя до монтирования не было: post-mount сбой идёт через пробы, как на любом документе', async () => {
    runScript('/invite/abc')
    const probe = stubServerBuildId('build-a')
    const { callHook, blocked } = install()

    callHook('app:mounted')
    preloadError(cssError)
    await vi.advanceTimersByTimeAsync(5000)

    expect(probe).toHaveBeenCalled()
    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({ reason: 'not-stale' })
  })
})
