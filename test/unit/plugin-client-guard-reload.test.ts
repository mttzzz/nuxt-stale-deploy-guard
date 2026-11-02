// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'

import { CHUNK_RELOAD_COOLDOWN_KEY } from '../../src/runtime/chunk-reload-guard'
import {
  chunkError,
  install,
  type Installed,
  preloadError,
  resolveError,
  runScript,
  setupPluginDeadLoad,
  stubServerBuildId,
  teardownPluginDeadLoad,
  unloadDocument,
} from './helpers/plugin-dead-load'
import { nuxtStub } from './stubs/nuxt-app'

/*
 * Цепочка «guard перезагрузил вкладку → новый документ уронил чанк ДО монтирования» целиком: настоящий guard и
 * плагин в первом документе, настоящий текст inline-скрипта и плагин — во втором, один sessionStorage на оба
 * (sessionStorage переживает reload, а с ним и cooldown guard'а). Это e2e ai.pushka.biz `35-chunk-reload-verify-before-
 * reload` («vite:preloadError + отличающийся build-id → ровно один reload»): после reload страница ещё гидрируется,
 * когда приходит второй `vite:preloadError`, — и до 0.9.1 его подхватывал скрипт со своим автоповтором `sdg-retry`, не
 * знавший о cooldown guard'а. Итог — ВТОРАЯ перезагрузка через долю секунды после первой. Теперь reload guard'а —
 * потраченный автоповтор: вместо второго reload экран «Страница не загрузилась» и одно `retry-failed`.
 * Скрипт отдельно (границы cooldown, значения штампа, SSR) — dead-load-guard-reload.test.ts.
 */

beforeEach(() => {
  setupPluginDeadLoad()
})

afterEach(() => {
  vi.useRealTimers()
  teardownPluginDeadLoad()
})

/* Документ 1: смонтирован, сервер уже на новом билде, чанк упал → guard подтверждает деплой и перезагружает вкладку. */
async function guardReloadsTab(): Promise<void> {
  stubServerBuildId('build-b')
  const before = install()
  before.callHook('app:mounted')
  preloadError(chunkError)
  await vi.waitFor(() => {
    expect(nuxtStub.reload).toHaveBeenCalledExactlyOnceWith({ force: true, persistState: true })
  })
  expect(sessionStorage.getItem(CHUNK_RELOAD_COOLDOWN_KEY)).not.toBeNull()
}

/* Документ 2: та же вкладка после reload — новый скрипт и новый плагин, sessionStorage прежний, приложение ещё не
   смонтировано (гидрация идёт). Адрес без маркера: guard перезагружает страницу как есть. */
function openReloadedDocument(): { replace: Mock<(target: string) => void>; page: Installed } {
  unloadDocument()
  nuxtStub.config.app.buildId = 'build-b'
  const replace = runScript('/invite/abc')
  return { replace, page: install() }
}

function screenState(): string | undefined {
  return document.querySelector<HTMLElement>('[data-sdg-dead-load]')?.dataset.sdgState
}

describe("после reload guard'а сбой до монтирования не даёт второй перезагрузки", () => {
  it('vite:preloadError → один reload на всю цепочку: экран «не загрузилась» и одно retry-failed с ошибкой', async () => {
    await guardReloadsTab()
    const { replace, page } = openReloadedDocument()

    const event = preloadError(chunkError)

    expect(event.defaultPrevented).toBe(true)
    expect(replace).not.toHaveBeenCalled()
    expect(nuxtStub.reload).toHaveBeenCalledOnce()
    expect(screenState()).toBe('failed')
    expect(page.blocked).toEqual([{ reason: 'retry-failed', kind: 'chunk', error: chunkError }])
  })

  it.each([
    ['app:error', (callHook: Installed['callHook']) => callHook('app:error', resolveError), resolveError],
    ['vue:error', (callHook: Installed['callHook']) => callHook('vue:error', resolveError), resolveError],
    [
      'app:chunkError',
      (callHook: Installed['callHook']) => callHook('app:chunkError', { error: chunkError }),
      chunkError,
    ],
  ])('%s из хука плагина до монтирования — то же: через мост, без второго reload', async (_name, trigger, error) => {
    await guardReloadsTab()
    const { replace, page } = openReloadedDocument()

    trigger(page.callHook)

    expect(replace).not.toHaveBeenCalled()
    expect(nuxtStub.reload).toHaveBeenCalledOnce()
    expect(screenState()).toBe('failed')
    expect(page.blocked).toEqual([{ reason: 'retry-failed', kind: 'chunk', error }])
  })

  it('экран один, а мёртвый для плагина документ молчит: после app:mounted ни проб, ни reload, ни событий', async () => {
    await guardReloadsTab()
    const { page } = openReloadedDocument()
    const probe = stubServerBuildId('build-b')
    vi.useFakeTimers()

    preloadError(chunkError)
    page.callHook('app:mounted')
    preloadError(chunkError)
    await vi.advanceTimersByTimeAsync(5000)

    expect(probe).not.toHaveBeenCalled()
    expect(nuxtStub.reload).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('[data-sdg-dead-load]')).toHaveLength(1)
    expect(page.blocked).toEqual([{ reason: 'retry-failed', kind: 'chunk', error: chunkError }])
  })

  it('контроль: вкладку guard НЕ перезагружал (штампа нет) — первый сбой до монтирования по-прежнему автоповтор', () => {
    const replace = runScript('/invite/abc')
    const { blocked } = install()

    preloadError(chunkError)

    expect(replace).toHaveBeenCalledExactlyOnceWith(`${globalThis.location.origin}/invite/abc?sdg-retry=chunk`)
    expect(screenState()).toBe('loading')
    expect(nuxtStub.reload).not.toHaveBeenCalled()
    expect(blocked).toEqual([])
  })
})
