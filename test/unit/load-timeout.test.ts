import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LoadTimeoutDetail } from '../../src/runtime/chunk-reload-guard'
import { buildDeadLoadScript } from '../../src/runtime/dead-load'
import { DEFAULT_SCREEN_THEME, DEFAULT_SCREEN_TEXTS } from '../../src/runtime/screen-config'
import { closePages, createPage } from './helpers/dead-load-page'

/*
 * Watchdog «приложение не загрузилось» (`app:load-timeout`): inline-скрипт из head запускает таймер на
 * `loadTimeoutMs` и, если приложение не смонтировалось и пользователю не показан экран «страница не
 * загрузилась», ОДИН раз сообщает об этом событием на window. Исполняем настоящий текст скрипта в
 * изолированном happy-dom-окне; время — fake timers (таймеры страницы идут в глобальные, см. helper).
 *
 * Что гасит watchdog: смонтированное приложение (`mounted()`), показанный экран «страница не загрузилась»
 * и экран «браузер без import maps» (`takenOver`). Оверлей автоповтора («Загружаем страницу…») НЕ гасит:
 * страница должна была уйти на перезагрузку; если не ушла — это ровно тот случай, о котором нужен отчёт
 * (в detail попадает `kind` увиденного сбоя).
 */

const TIMEOUT_MS = 45_000

function scriptWithTimeout(loadTimeoutMs: number) {
  return buildDeadLoadScript({ theme: DEFAULT_SCREEN_THEME, texts: DEFAULT_SCREEN_TEXTS, loadTimeoutMs })
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  /* Сначала реальные таймеры: happy-dom при закрытии окна ждёт завершения задач. */
  vi.useRealTimers()
  await closePages()
})

describe('watchdog — приложение не загрузилось', () => {
  it('по истечении таймаута шлёт app:load-timeout: detail с timeoutMs, elapsedMs и url', () => {
    const page = createPage({ script: scriptWithTimeout(TIMEOUT_MS) })
    page.run()
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(page.timeouts).toHaveLength(1)
    const detail = page.timeouts[0] as LoadTimeoutDetail
    expect(detail.reason).toBe('load-timeout')
    expect(detail.timeoutMs).toBe(TIMEOUT_MS)
    expect(detail.elapsedMs).toBeGreaterThanOrEqual(TIMEOUT_MS)
    expect(detail.url).toBe(page.window.location.href)
  })

  it('до истечения таймаута отчёта нет', () => {
    const page = createPage({ script: scriptWithTimeout(TIMEOUT_MS) })
    page.run()

    vi.advanceTimersByTime(TIMEOUT_MS - 1)

    expect(page.timeouts).toEqual([])
  })

  it('приложение смонтировалось (app:mounted) → отчёта нет', () => {
    const page = createPage({ script: scriptWithTimeout(TIMEOUT_MS) })
    page.run()
    page.mounted()

    vi.advanceTimersByTime(TIMEOUT_MS * 3)

    expect(page.timeouts).toEqual([])
  })

  it('показан экран «страница не загрузилась» → отчёта нет', () => {
    const page = createPage({ url: 'https://app.example.com/a?sdg-retry=chunk', script: scriptWithTimeout(TIMEOUT_MS) })
    page.run()
    page.preloadError(new Error('boom'))
    expect(page.document.querySelector('[data-sdg-state="failed"]')).not.toBeNull()

    vi.advanceTimersByTime(TIMEOUT_MS * 3)

    expect(page.timeouts).toEqual([])
  })

  it('экран «браузер без import maps» (takenOver) → отчёта нет: про этот случай отчёт уже есть', () => {
    const page = createPage({ script: scriptWithTimeout(TIMEOUT_MS) })
    /* `takenOver` ставит importmap-check до `window.stop()` — состояние общее для обоих inline-скриптов. */
    Reflect.set(page.window, '__sdgDeadLoad', { takenOver: true })
    page.run()

    vi.advanceTimersByTime(TIMEOUT_MS * 3)

    expect(page.timeouts).toEqual([])
  })

  it('ровно один отчёт за документ, даже когда время идёт дальше', () => {
    const page = createPage({ script: scriptWithTimeout(TIMEOUT_MS) })
    page.run()

    vi.advanceTimersByTime(TIMEOUT_MS * 3)

    expect(page.timeouts).toHaveLength(1)
  })

  it('после автоповтора страница не ушла → отчёт с kind увиденного сбоя', () => {
    const page = createPage({ script: scriptWithTimeout(TIMEOUT_MS) })
    page.run()
    page.preloadError(new Error('boom'))

    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(page.timeouts).toHaveLength(1)
    const detail = page.timeouts[0] as LoadTimeoutDetail
    expect(detail.kind).toBe('chunk')
  })

  it('таймаут 0 → watchdog выключен', () => {
    const page = createPage({ script: scriptWithTimeout(0) })
    page.run()

    vi.advanceTimersByTime(TIMEOUT_MS * 3)

    expect(page.timeouts).toEqual([])
  })

  it('таймаут из опции модуля — ровно тот, что ждём: ни миллисекундой раньше, ни позже', () => {
    const page = createPage({ script: scriptWithTimeout(1234) })
    page.run()

    vi.advanceTimersByTime(1233)
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(1)
    expect(page.timeouts).toHaveLength(1)
    expect((page.timeouts[0] as LoadTimeoutDetail).timeoutMs).toBe(1234)
  })
})
