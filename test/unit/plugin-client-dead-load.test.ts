// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEAD_LOAD_GLOBAL } from '../../src/runtime/dead-load-bridge'
import {
  chunkError,
  createBridge,
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
 * Клиентский плагин и inline-скрипт «страница не загрузилась» (dead-load.ts): до `app:mounted` сбой чанка из
 * любого канала уходит в мост `window.__sdgDeadLoad` — сразу, без HEAD-проб; на `app:mounted` плагин сообщает
 * мосту `mounted()` и убирает из URL только ключ `sdg-retry`; после монтирования каналы работают как всегда
 * (пробы, verify-before-reload, событие `app:chunk-reload-blocked`). Нет моста — всё как раньше.
 * Плагин ставится заново в каждом тесте, а его слушатели window снимаются в afterEach: `mounted` живёт в замыкании.
 * Оснастка (установка плагина, шпионы, запуск настоящего текста скрипта) — helpers/plugin-dead-load.ts;
 * документ, уже переживший сбой, — plugin-client-dead-load-handled.test.ts.
 */

beforeEach(() => {
  setupPluginDeadLoad()
})

afterEach(() => {
  teardownPluginDeadLoad()
})

describe('до app:mounted с мостом: каждый канал сдаёт исходную ошибку мосту, без проб и без событий guard', () => {
  it('vite:preloadError → fail("chunk", payload); событие гасится, как и раньше', () => {
    const bridge = createBridge()
    const probe = stubServerBuildId('build-b')
    const { blocked } = install()
    const event = preloadError(chunkError)
    expect(bridge.fail).toHaveBeenCalledExactlyOnceWith('chunk', chunkError)
    expect(event.defaultPrevented).toBe(true)
    expect(probe).not.toHaveBeenCalled()
    expect(blocked).toEqual([])
    expect(nuxtStub.reload).not.toHaveBeenCalled()
  })

  it('vite:preloadError без payload → fail("chunk") с пустой ошибкой', () => {
    const bridge = createBridge()
    install()
    globalThis.dispatchEvent(new Event('vite:preloadError', { cancelable: true }))
    expect(bridge.fail).toHaveBeenCalledOnce()
    expect(bridge.fail.mock.calls[0]?.[0]).toBe('chunk')
    expect(bridge.fail.mock.calls[0]?.[1]).toBeUndefined()
  })

  it('app:chunkError → error из { error }; как и раньше, без фильтра по тексту', () => {
    const bridge = createBridge()
    const { callHook } = install()
    callHook('app:chunkError', { error: chunkError })
    const cssError = new Error('Unable to preload CSS for /_nuxt/invite.css')
    callHook('app:chunkError', { error: cssError })
    expect(bridge.fail.mock.calls).toEqual([
      ['chunk', chunkError],
      ['chunk', cssError],
    ])
  })

  it.each(['vue:error', 'app:error'])('%s со stale-chunk ошибкой → fail("chunk", error)', (hook) => {
    const bridge = createBridge()
    const probe = stubServerBuildId('build-b')
    const { callHook, blocked } = install()
    callHook(hook, resolveError)
    expect(bridge.fail).toHaveBeenCalledExactlyOnceWith('chunk', resolveError)
    expect(probe).not.toHaveBeenCalled()
    expect(blocked).toEqual([])
  })

  it.each(['vue:error', 'app:error'])('%s с посторонней ошибкой → мост и guard молчат', (hook) => {
    const bridge = createBridge()
    const probe = stubServerBuildId('build-b')
    const { callHook, blocked } = install()
    callHook(hook, new TypeError('Cannot read properties of undefined'))
    expect(bridge.fail).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(blocked).toEqual([])
  })

  it('unhandledrejection со stale-chunk reason → гасится и уходит мосту; посторонний reason не трогается', () => {
    const bridge = createBridge()
    install()
    const stale = unhandledRejection(chunkError)
    expect(stale.defaultPrevented).toBe(true)
    expect(bridge.fail).toHaveBeenCalledExactlyOnceWith('chunk', chunkError)

    bridge.fail.mockClear()
    const other = unhandledRejection(new Error('Cannot read properties of undefined'))
    expect(other.defaultPrevented).toBe(false)
    expect(bridge.fail).not.toHaveBeenCalled()
  })

  it('error со stale-chunk event.error → гасится и уходит мосту; без event.error — message; посторонний не трогается', () => {
    const bridge = createBridge()
    install()
    const withError = windowError(chunkError, chunkError.message)
    expect(withError.defaultPrevented).toBe(true)
    expect(bridge.fail).toHaveBeenLastCalledWith('chunk', chunkError)

    windowError(undefined, 'Importing a module script failed.')
    expect(bridge.fail).toHaveBeenLastCalledWith('chunk', 'Importing a module script failed.')
    expect(bridge.fail).toHaveBeenCalledTimes(2)

    bridge.fail.mockClear()
    const other = windowError(new Error('Cannot read properties of undefined'), 'Cannot read properties of undefined')
    expect(other.defaultPrevented).toBe(false)
    expect(bridge.fail).not.toHaveBeenCalled()
  })
})

describe('app:mounted', () => {
  it('сообщает мосту mounted() ровно один раз', () => {
    const bridge = createBridge()
    const { callHook } = install()
    callHook('app:mounted')
    expect(bridge.mounted).toHaveBeenCalledOnce()
    expect(bridge.fail).not.toHaveBeenCalled()
  })

  it('в адресе маркер sdg-retry → router.replace без него; прочие query (в том числе массивы) и hash на месте', () => {
    createBridge()
    nuxtStub.router.currentRoute.value = {
      path: '/invite/abc',
      query: { x: '1', 'sdg-retry': 'chunk', tag: ['a', 'b'] },
      hash: '#top',
    }
    const { callHook } = install()
    callHook('app:mounted')
    expect(nuxtStub.router.replace).toHaveBeenCalledExactlyOnceWith({
      path: '/invite/abc',
      query: { x: '1', tag: ['a', 'b'] },
      hash: '#top',
    })
  })

  it('маркер — единственный параметр → query становится пустым', () => {
    createBridge()
    nuxtStub.router.currentRoute.value = { path: '/', query: { 'sdg-retry': 'entry' }, hash: '' }
    const { callHook } = install()
    callHook('app:mounted')
    expect(nuxtStub.router.replace).toHaveBeenCalledExactlyOnceWith({ path: '/', query: {}, hash: '' })
  })

  it('маркера нет → адрес не трогается', () => {
    createBridge()
    nuxtStub.router.currentRoute.value = { path: '/invite/abc', query: { x: '1' }, hash: '#top' }
    const { callHook } = install()
    callHook('app:mounted')
    expect(nuxtStub.router.replace).not.toHaveBeenCalled()
  })

  it('router.replace отклонён → приложение не падает и необработанного reject нет', async () => {
    createBridge()
    nuxtStub.router.replace.mockRejectedValueOnce(new Error('navigation aborted'))
    nuxtStub.router.currentRoute.value = { path: '/', query: { 'sdg-retry': 'chunk' }, hash: '' }
    const { callHook } = install()
    expect(() => callHook('app:mounted')).not.toThrow()
    await vi.waitFor(() => {
      expect(nuxtStub.router.replace).toHaveBeenCalledOnce()
    })
    await Promise.resolve()
  })
})

describe('после app:mounted — прежнее поведение (пробы, verify-before-reload, события)', () => {
  it('vite:preloadError со stale-chunk → HEAD-проба; build-id чужой → reload; мост не зовётся', async () => {
    const bridge = createBridge()
    const probe = stubServerBuildId('build-b')
    const { callHook } = install()
    callHook('app:mounted')
    const event = preloadError(chunkError)
    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => {
      expect(nuxtStub.reload).toHaveBeenCalledExactlyOnceWith({ force: true, persistState: true })
    })
    expect(probe).toHaveBeenCalledOnce()
    expect(String(probe.mock.calls[0]?.[0])).toContain('sdg-probe=')
    expect(bridge.fail).not.toHaveBeenCalled()
  })

  it.each([
    ['app:chunkError', (callHook: Installed['callHook']) => callHook('app:chunkError', { error: chunkError })],
    ['vue:error', (callHook: Installed['callHook']) => callHook('vue:error', chunkError)],
    ['app:error', (callHook: Installed['callHook']) => callHook('app:error', chunkError)],
  ])('%s → верификация: проба ушла, мост не зовётся', async (_name, trigger) => {
    const bridge = createBridge()
    const probe = stubServerBuildId('build-b')
    const { callHook } = install()
    callHook('app:mounted')
    trigger(callHook)
    await vi.waitFor(() => {
      expect(nuxtStub.reload).toHaveBeenCalledOnce()
    })
    expect(probe).toHaveBeenCalledOnce()
    expect(bridge.fail).not.toHaveBeenCalled()
  })

  it('unhandledrejection и error → тоже через guard, с исходной ошибкой в событии исхода', async () => {
    nuxtStub.config.app.buildId = ''
    const bridge = createBridge()
    const { callHook, blocked } = install()
    callHook('app:mounted')
    unhandledRejection(chunkError)
    windowError(chunkError, chunkError.message)
    await vi.waitFor(() => {
      expect(blocked).toHaveLength(2)
    })
    expect(blocked).toEqual([
      { reason: 'no-build-id', error: chunkError },
      { reason: 'no-build-id', error: chunkError },
    ])
    expect(bridge.fail).not.toHaveBeenCalled()
  })
})

describe('моста нет (dev, старый HTML) — всё как раньше', () => {
  it('до app:mounted сбой идёт через guard: событие исхода с ошибкой, мост не нужен', async () => {
    nuxtStub.config.app.buildId = ''
    const { callHook, blocked } = install()
    const event = preloadError(chunkError)
    callHook('app:error', resolveError)
    expect(event.defaultPrevented).toBe(true)
    await vi.waitFor(() => {
      expect(blocked).toHaveLength(2)
    })
    expect(blocked).toEqual([
      { reason: 'no-build-id', error: chunkError },
      { reason: 'no-build-id', error: resolveError },
    ])
  })

  it('app:mounted адрес не трогает, даже если маркер в нём есть', () => {
    nuxtStub.router.currentRoute.value = { path: '/', query: { 'sdg-retry': 'chunk' }, hash: '' }
    const { callHook } = install()
    expect(() => callHook('app:mounted')).not.toThrow()
    expect(nuxtStub.router.replace).not.toHaveBeenCalled()
  })

  it('объект с тем же именем, но без fail/mounted, мостом не считается', async () => {
    nuxtStub.config.app.buildId = ''
    Reflect.set(globalThis, DEAD_LOAD_GLOBAL, { takenOver: true })
    const { callHook, blocked } = install()
    callHook('app:error', resolveError)
    callHook('app:mounted')
    await vi.waitFor(() => {
      expect(blocked).toHaveLength(1)
    })
    expect(blocked).toEqual([{ reason: 'no-build-id', error: resolveError }])
  })
})

describe('плагин + настоящий скрипт dead-load: рукопожатие через window.__sdgDeadLoad', () => {
  it('сбой чанка из хука плагина до монтирования → повтор страницы с sdg-retry=chunk', () => {
    const replace = runScript('/invite/abc?x=1#top')
    const { callHook, blocked } = install()
    callHook('app:error', resolveError)
    expect(replace).toHaveBeenCalledExactlyOnceWith(`${globalThis.location.origin}/invite/abc?x=1&sdg-retry=chunk#top`)
    expect(document.querySelector<HTMLElement>('[data-sdg-dead-load]')?.dataset.sdgState).toBe('loading')
    expect(blocked).toEqual([])
  })

  it('сбой на URL с маркером → экран и ровно одно retry-failed с исходной ошибкой плагина', () => {
    const replace = runScript('/invite/abc?sdg-retry=chunk')
    const { callHook, blocked } = install()
    callHook('app:error', resolveError)
    callHook('vue:error', resolveError)
    preloadError(chunkError)
    expect(replace).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLElement>('[data-sdg-dead-load]')?.dataset.sdgState).toBe('failed')
    expect(blocked).toEqual([{ reason: 'retry-failed', kind: 'chunk', error: resolveError }])
  })

  it('после app:mounted скрипт молчит, а плагин убирает маркер из адреса и сам ведёт сбой через guard', async () => {
    const replace = runScript('/invite/abc?sdg-retry=chunk')
    stubServerBuildId('build-b')
    nuxtStub.router.currentRoute.value = { path: '/invite/abc', query: { 'sdg-retry': 'chunk' }, hash: '' }
    const { callHook, blocked } = install()
    callHook('app:mounted')
    preloadError(chunkError)
    expect(nuxtStub.router.replace).toHaveBeenCalledExactlyOnceWith({ path: '/invite/abc', query: {}, hash: '' })
    await vi.waitFor(() => {
      expect(nuxtStub.reload).toHaveBeenCalledOnce()
    })
    expect(replace).not.toHaveBeenCalled()
    expect(document.querySelector('[data-sdg-dead-load]')).toBeNull()
    expect(blocked).toEqual([])
  })
})
