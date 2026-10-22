// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEAD_LOAD_GLOBAL } from '../../src/runtime/dead-load-bridge'
import {
  chunkError,
  createBridge,
  cssError,
  install,
  preloadError,
  resolveError,
  runScript,
  setupPluginDeadLoad,
  stubServerBuildId,
  teardownPluginDeadLoad,
  unhandledRejection,
  windowError,
  type Installed,
} from './helpers/plugin-dead-load'
import { nuxtStub } from './stubs/nuxt-app'

/*
 * Документ, который УЖЕ пережил сбой (inline-скрипт сделал автоповтор или показал экран «Страница не
 * загрузилась»), для плагина мёртв: ни одного канала, ни HEAD-проб, ни событий, ни снятия маркера `sdg-retry`.
 * Иначе уходящая страница (навигация обрывает загрузку CSS её страницы ошибки) шлёт ложный «билд актуален» —
 * Sentry KP-MODMB-COM-1H, 21.10.2026: проба не дошла до сервера, build-id совпал, событие `not-stale`.
 * Оснастка (установка плагина, шпионы, запуск настоящего текста скрипта) — helpers/plugin-dead-load.ts.
 */

beforeEach(() => {
  setupPluginDeadLoad()
  /* Виртуальные часы: серия проб guard'а — это 4 запроса с паузой 400 мс. Под виртуальными часами они
     догоняются мгновенно, и «лишний» вердикт (not-stale) успевает уехать до проверки. */
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  teardownPluginDeadLoad()
})

describe('документ, уже переживший сбой: плагин молчит до конца жизни документа', () => {
  it('автоповтор сделан → post-mount сбой загрузки CSS не даёт ни проб, ни событий', async () => {
    const replace = runScript('/invite/abc?x=1#top')
    const probe = stubServerBuildId('build-a')
    const { callHook, blocked } = install()
    /* Сбой до монтирования: плагин отдаёт его inline-скрипту, тот делает автоповтор страницы. */
    callHook('app:error', resolveError)
    expect(replace).toHaveBeenCalledOnce()
    /* Приложение успело смонтироваться: уходящий документ живёт ещё секунды. */
    callHook('app:mounted')
    const event = preloadError(cssError)
    expect(event.defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(probe).not.toHaveBeenCalled()
    expect(nuxtStub.reload).not.toHaveBeenCalled()
    expect(blocked).toEqual([])
  })

  it('экран «Страница не загрузилась» показан → post-mount сбой: ни проб, ни второго события', async () => {
    const replace = runScript('/invite/abc?sdg-retry=chunk')
    const probe = stubServerBuildId('build-a')
    const { callHook, blocked } = install()
    callHook('app:error', resolveError)
    expect(replace).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLElement>('[data-sdg-dead-load]')?.dataset.sdgState).toBe('failed')
    callHook('app:mounted')
    const event = preloadError(cssError)
    expect(event.defaultPrevented).toBe(true)
    await vi.advanceTimersByTimeAsync(5000)
    expect(probe).not.toHaveBeenCalled()
    expect(nuxtStub.reload).not.toHaveBeenCalled()
    /* Единственное событие документа — retry-failed самого скрипта. */
    expect(blocked).toEqual([{ reason: 'retry-failed', kind: 'chunk', error: resolveError }])
  })

  it.each([
    ['app:chunkError', (callHook: Installed['callHook']) => callHook('app:chunkError', { error: chunkError })],
    ['vue:error', (callHook: Installed['callHook']) => callHook('vue:error', chunkError)],
    ['app:error', (callHook: Installed['callHook']) => callHook('app:error', chunkError)],
    ['vite:preloadError', () => preloadError(cssError)],
    ['unhandledrejection', () => unhandledRejection(chunkError)],
    ['error', () => windowError(chunkError, chunkError.message)],
  ])('канал %s в уже пережившем сбоой документе → ни проб, ни событий', async (_name, trigger) => {
    const replace = runScript('/invite/abc?x=1')
    const probe = stubServerBuildId('build-a')
    const { callHook, blocked } = install()
    /* Сбой до монтирования → автоповтор: документ «пережил сбой». */
    callHook('app:error', resolveError)
    expect(replace).toHaveBeenCalledOnce()
    callHook('app:mounted')
    trigger(callHook)
    await vi.advanceTimersByTimeAsync(5000)
    expect(probe).not.toHaveBeenCalled()
    expect(nuxtStub.reload).not.toHaveBeenCalled()
    expect(blocked).toEqual([])
  })

  it('маркер sdg-retry остаётся в адресе: кнопка «Обновить» = одна попытка на нажатие', () => {
    runScript('/invite/abc?sdg-retry=chunk')
    nuxtStub.router.currentRoute.value = { path: '/invite/abc', query: { 'sdg-retry': 'chunk' }, hash: '' }
    const bridge = Reflect.get(globalThis, DEAD_LOAD_GLOBAL) as { mounted: () => void }
    const mountedSpy = vi.spyOn(bridge, 'mounted')
    const { callHook } = install()
    callHook('app:error', resolveError)
    callHook('app:mounted')
    expect(nuxtStub.router.replace).not.toHaveBeenCalled()
    expect(mountedSpy).not.toHaveBeenCalled()
  })

  it('poll не вердиктит документ, уже переживший сбой', async () => {
    nuxtStub.config.public.staleDeployGuard.pollIntervalMs = 50
    const replace = runScript('/invite/abc?x=1')
    const probe = stubServerBuildId('build-a')
    const { callHook } = install()
    callHook('app:error', resolveError)
    expect(replace).toHaveBeenCalledOnce()
    callHook('app:mounted')
    await vi.advanceTimersByTimeAsync(2000)
    expect(probe).not.toHaveBeenCalled()
  })

  it('poll работает как раньше, пока документ не пережил сбой', async () => {
    nuxtStub.config.public.staleDeployGuard.pollIntervalMs = 50
    runScript('/invite/abc?x=1')
    const probe = stubServerBuildId('build-a')
    const { callHook } = install()
    callHook('app:mounted')
    await vi.advanceTimersByTimeAsync(2000)
    expect(probe).toHaveBeenCalled()
  })

  it('мост без handled() (inline-скрипт 0.6.0) → поведение прежнее: post-mount сбой идёт через пробы', async () => {
    createBridge()
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
