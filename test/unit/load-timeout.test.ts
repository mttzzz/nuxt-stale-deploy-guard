import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LoadTimeoutDetail } from '../../src/runtime/chunk-reload-guard'
import { DEAD_LOAD_GLOBAL } from '../../src/runtime/dead-load-bridge'
import { closePages, createPage, type Page, type PageOptions, scriptWithTimeout } from './helpers/dead-load-page'

/*
 * Watchdog «приложение не загрузилось» (`app:load-timeout`): inline-скрипт из head копит ВИДИМОЕ время и, когда оно
 * дорастает до `loadTimeoutMs`, а приложение не смонтировалось и пользователю не показан экран «страница не
 * загрузилась», ОДИН раз сообщает об этом событием на window. Исполняем настоящий текст скрипта в изолированном
 * happy-dom-окне; время — fake timers (интервалы и дата страницы идут в глобальные, см. helper).
 *
 * Время идёт только пока вкладка на экране: скрытая, замороженная и уснувшая не копят, а вкладка, так и не ставшая
 * видимой, не шлёт ничего (Sentry KP-MODMB-COM-1J: 4 из 10 событий — фоновые вкладки восстановленной сессии Chrome и
 * замороженная вкладка Android). Что гасит watchdog: смонтированное приложение (`mounted()`), показанный экран
 * «страница не загрузилась» и экран «браузер без import maps» (`takenOver`). Оверлей автоповтора («Загружаем
 * страницу…») НЕ гасит: страница должна была уйти на перезагрузку; если не ушла — это ровно тот случай, о котором
 * нужен отчёт (в detail попадает `kind` увиденного сбоя). Что именно отправляется кроме времени — диагностика
 * (стадия, зависшие ресурсы, ошибки) — load-timeout-diagnostics.test.ts.
 */

const TIMEOUT_MS = 30_000
const SECOND = 1000
const MINUTE = 60 * SECOND

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  /* Сначала реальные таймеры: happy-dom при закрытии окна ждёт завершения задач. */
  vi.useRealTimers()
  await closePages()
})

function startPage(options: PageOptions = {}, loadTimeoutMs = TIMEOUT_MS): Page {
  const page = createPage({ script: scriptWithTimeout(loadTimeoutMs), ...options })
  page.run()
  return page
}

/* Единственный отчёт страницы. */
function onlyReport(page: Page): LoadTimeoutDetail {
  expect(page.timeouts).toHaveLength(1)
  return page.timeouts[0] as LoadTimeoutDetail
}

describe('watchdog — порог видимого времени', () => {
  it('вкладка на экране весь срок: до порога тишина, на пороге ровно один отчёт с временем', () => {
    const page = startPage()

    vi.advanceTimersByTime(TIMEOUT_MS - SECOND)
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(SECOND)
    expect(onlyReport(page)).toMatchObject({
      reason: 'load-timeout',
      timeoutMs: TIMEOUT_MS,
      visibleMs: TIMEOUT_MS,
      hiddenMs: 0,
      elapsedMs: TIMEOUT_MS,
      url: page.window.location.href,
    })
  })

  it('порог из опции модуля — ровно тот, что ждём: ни секундой раньше, ни позже', () => {
    const page = startPage({}, 3 * SECOND)

    vi.advanceTimersByTime(3 * SECOND - 1)
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(1)
    expect(onlyReport(page).timeoutMs).toBe(3 * SECOND)
  })

  it('порог не кратен секунде: отчёт на первом тике после порога, visibleMs не меньше timeoutMs', () => {
    const page = startPage({}, 2500)

    vi.advanceTimersByTime(2999)
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(1)
    expect(onlyReport(page)).toMatchObject({ timeoutMs: 2500, visibleMs: 3 * SECOND, elapsedMs: 3 * SECOND })
  })

  it('дефолтный порог — 45 с видимого времени', () => {
    const page = createPage()
    page.run()

    vi.advanceTimersByTime(44 * SECOND)
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(SECOND)
    expect(onlyReport(page).timeoutMs).toBe(45_000)
  })

  it('таймаут 0 — watchdog выключен: ни интервала, ни отчёта', () => {
    const page = startPage({}, 0)
    expect(page.liveIntervals()).toBe(0)

    page.runtimeError({ message: 'boom' })
    vi.advanceTimersByTime(TIMEOUT_MS * 3)

    expect(page.timeouts).toEqual([])
  })
})

describe('watchdog — скрытое время не считается', () => {
  it('вкладка скрыта с самого начала — отчёта нет, сколько бы ни прошло', () => {
    const page = startPage({ visibility: 'hidden' })

    vi.advanceTimersByTime(TIMEOUT_MS * 10)

    expect(page.timeouts).toEqual([])
  })

  it('скрытая вкладка смонтировалась через 57 с (сессия Chrome с фоновыми вкладками) — отчёта нет', () => {
    const page = startPage({ visibility: 'hidden' })

    vi.advanceTimersByTime(57 * SECOND)
    page.mounted()
    vi.advanceTimersByTime(TIMEOUT_MS * 10)

    expect(page.timeouts).toEqual([])
  })

  it('вкладка 5 мин в фоне, потом открыта: порог отсчитывается с момента, когда её увидели', () => {
    const page = startPage({ visibility: 'hidden' })
    vi.advanceTimersByTime(5 * MINUTE)

    page.setVisibility('visible')
    vi.advanceTimersByTime(TIMEOUT_MS - SECOND)
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(SECOND)
    expect(onlyReport(page)).toMatchObject({
      visibleMs: TIMEOUT_MS,
      hiddenMs: 5 * MINUTE,
      elapsedMs: 5 * MINUTE + TIMEOUT_MS,
    })
  })

  it('20 с на экране → 5 мин в фоне → 10 с на экране (порог 30 с): один отчёт, visibleMs 30 с, hiddenMs 5 мин', () => {
    const page = startPage()

    vi.advanceTimersByTime(20 * SECOND)
    page.setVisibility('hidden')
    vi.advanceTimersByTime(5 * MINUTE)
    expect(page.timeouts).toEqual([])

    page.setVisibility('visible')
    vi.advanceTimersByTime(10 * SECOND)

    expect(onlyReport(page)).toMatchObject({
      visibleMs: 30 * SECOND,
      hiddenMs: 5 * MINUTE,
      elapsedMs: 20 * SECOND + 5 * MINUTE + 10 * SECOND,
    })
  })

  it('возврат во вкладку обнуляет прошлый тик: скрытый кусок, пока тиков не было, в счётчик не попадает', () => {
    const page = startPage({}, 11 * SECOND)
    vi.advanceTimersByTime(10 * SECOND)

    page.setVisibility('hidden')
    /* Таймеры скрытой вкладки почти не ходят (Chrome — раз в минуту, iOS — стоят): за 10 мин тиков не было. */
    vi.setSystemTime(Date.now() + 10 * MINUTE)
    page.setVisibility('visible')
    vi.advanceTimersByTime(SECOND)

    expect(onlyReport(page)).toMatchObject({ visibleMs: 11 * SECOND, hiddenMs: 10 * MINUTE })
  })

  it('visibilitychange не пришёл (баг браузера): потолок тика не даёт засчитать скрытые 10 мин — только 2 с', () => {
    const page = startPage({}, 12 * SECOND)
    vi.advanceTimersByTime(10 * SECOND)

    page.setVisibility('hidden', { silent: true })
    vi.setSystemTime(Date.now() + 10 * MINUTE)
    page.setVisibility('visible', { silent: true })
    vi.advanceTimersByTime(SECOND)

    expect(onlyReport(page)).toMatchObject({ visibleMs: 12 * SECOND, hiddenMs: 10 * MINUTE - SECOND })
  })

  it('тики сами видят скрытое состояние, даже когда visibilitychange не приходит', () => {
    const page = startPage({}, 12 * SECOND)
    vi.advanceTimersByTime(10 * SECOND)

    page.setVisibility('hidden', { silent: true })
    vi.advanceTimersByTime(MINUTE)
    expect(page.timeouts).toEqual([])

    page.setVisibility('visible', { silent: true })
    vi.advanceTimersByTime(2 * SECOND)

    expect(onlyReport(page)).toMatchObject({ visibleMs: 12 * SECOND, hiddenMs: MINUTE })
  })

  it('устаревшее prerender — вкладка скрыта: счёт начинается, когда её показали', () => {
    const page = startPage({ visibility: 'prerender' })
    vi.advanceTimersByTime(TIMEOUT_MS * 2)
    expect(page.timeouts).toEqual([])

    page.setVisibility('visible')
    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(onlyReport(page)).toMatchObject({ visibleMs: TIMEOUT_MS, hiddenMs: TIMEOUT_MS * 2 })
  })

  it('нет document.visibilityState (старый браузер) — вкладка считается видимой', () => {
    const page = startPage({ visibility: 'absent' })

    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(onlyReport(page)).toMatchObject({ visibleMs: TIMEOUT_MS, hiddenMs: 0 })
  })
})

describe('watchdog — пауза без тиков и сбои часов', () => {
  it('заморозка видимой вкладки (сон ноутбука, пауза WebView): пауза без тиков засчитывается не больше чем в 2 с', () => {
    const page = startPage()
    vi.advanceTimersByTime(5 * SECOND)

    /* Десять минут без тиков, затем один тик с огромной разницей: 5 с + 2 с, а не 10 мин «видимого» ожидания. */
    vi.setSystemTime(Date.now() + 10 * MINUTE)
    vi.advanceTimersByTime(SECOND)
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(22 * SECOND)
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(SECOND)
    expect(onlyReport(page)).toMatchObject({
      visibleMs: TIMEOUT_MS,
      elapsedMs: 5 * SECOND + 10 * MINUTE + 24 * SECOND,
      hiddenMs: 10 * MINUTE - SECOND,
    })
  })

  it('часы ушли назад: отрицательная разница не отнимает у счётчика', () => {
    const page = startPage()
    vi.advanceTimersByTime(5 * SECOND)

    vi.setSystemTime(Date.now() - MINUTE)
    vi.advanceTimersByTime(SECOND)
    vi.advanceTimersByTime(24 * SECOND)
    expect(page.timeouts).toEqual([])

    vi.advanceTimersByTime(SECOND)
    expect(onlyReport(page)).toMatchObject({ visibleMs: TIMEOUT_MS, hiddenMs: 0 })
  })
})

describe('watchdog — что его гасит', () => {
  it('приложение смонтировалось до порога: интервал остановлен, отчёта нет — ни тогда, ни потом', () => {
    const page = startPage()
    vi.advanceTimersByTime(10 * SECOND)
    expect(page.liveIntervals()).toBe(1)

    page.mounted()
    expect(page.liveIntervals()).toBe(0)

    page.runtimeError({ message: 'после монтирования' })
    page.rejection(new Error('после монтирования'))
    vi.advanceTimersByTime(TIMEOUT_MS * 3)

    expect(page.timeouts).toEqual([])
  })

  it('показан экран «страница не загрузилась»: интервал остановлен, отчёта нет', () => {
    const page = startPage({ url: 'https://app.example.com/a?sdg-retry=chunk' })
    page.preloadError(new Error('boom'))
    expect(page.document.querySelector('[data-sdg-state="failed"]')).not.toBeNull()
    expect(page.liveIntervals()).toBe(0)

    vi.advanceTimersByTime(TIMEOUT_MS * 3)

    expect(page.timeouts).toEqual([])
  })

  it('экран «браузер без import maps» (takenOver): интервал гаснет на ближайшем тике, отчёта нет — про этот случай отчёт уже есть', () => {
    const page = startPage()
    vi.advanceTimersByTime(5 * SECOND)

    /* `takenOver` ставит importmap-check (bodyClose, то есть уже после dead-load) до `window.stop()`. */
    const shared: unknown = Reflect.get(page.window, DEAD_LOAD_GLOBAL)
    Reflect.set(shared as object, 'takenOver', true)
    vi.advanceTimersByTime(SECOND)
    expect(page.liveIntervals()).toBe(0)

    vi.advanceTimersByTime(TIMEOUT_MS * 3)
    expect(page.timeouts).toEqual([])
  })

  it('ровно один отчёт за документ: после него интервал остановлен, время дальше ничего не меняет', () => {
    const page = startPage()

    vi.advanceTimersByTime(TIMEOUT_MS)
    expect(page.liveIntervals()).toBe(0)
    vi.advanceTimersByTime(TIMEOUT_MS * 3)

    expect(page.timeouts).toHaveLength(1)
  })

  it('после автоповтора страница не ушла → отчёт с kind увиденного сбоя: оверлей автоповтора watchdog не гасит', () => {
    const page = startPage()
    page.preloadError(new Error('boom'))
    expect(page.replace).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(onlyReport(page).kind).toBe('chunk')
  })
})
