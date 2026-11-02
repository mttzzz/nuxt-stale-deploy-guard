import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { CHUNK_RELOAD_COOLDOWN_KEY, CHUNK_RELOAD_COOLDOWN_MS } from '../../src/runtime/chunk-reload-guard'
import {
  closePages,
  createPage,
  ENTRY_URL,
  expectNothingHappened,
  type Page,
  requireScreen,
  screenOf,
} from './helpers/dead-load-page'

/*
 * Сбой до монтирования на документе, который открыл reload guard'а. Guard пишет `markReloadNow()` в sessionStorage
 * (`chunk-reload:last-reload-at`) ПЕРЕД `reload()` — cooldown переживает перезагрузку. Автоповтор inline-скрипта
 * (маркер `sdg-retry`) — вторая, независимая защита от петли, и раньше он этого штампа не читал: сбой чанка на
 * странице, которую guard открыл секунду назад, давал ВТОРУЮ перезагрузку (первую делал guard, вторую — скрипт).
 * Теперь reload guard'а — это уже потраченный автоповтор: пока идёт его cooldown, скрипт второй reload не делает, а
 * сразу показывает экран «Страница не загрузилась» и шлёт ровно одно `retry-failed`. Поведение вне cooldown и без
 * штампа — прежнее (dead-load.test.ts). Полная цепочка с настоящим guard'ом и плагином —
 * plugin-client-guard-reload.test.ts.
 */

const NOW = Date.parse('2026-11-02T12:00:00Z')

beforeEach(() => {
  /* Только дата: интервалы watchdog'а и промисы остаются настоящими, а возраст штампа считаем от замороженных часов. */
  vi.useFakeTimers({ now: NOW, toFake: ['Date'] })
})

afterEach(async () => {
  vi.useRealTimers()
  await closePages()
})

/* Штамп guard'а: «вкладку перезагрузили `agoMs` назад» (строка в sessionStorage страницы — как пишет guard). */
function stampGuardReload(page: Page, agoMs: number): void {
  page.window.sessionStorage.setItem(CHUNK_RELOAD_COOLDOWN_KEY, String(NOW - agoMs))
}

function expectFailureScreen(page: Page): void {
  expect(page.replace).not.toHaveBeenCalled()
  expect(page.reload).not.toHaveBeenCalled()
  expect(requireScreen(page).dataset.sdgState).toBe('failed')
}

describe("reload guard'а меньше cooldown назад — автоповтор уже потрачен", () => {
  it('vite:preloadError без маркера в URL → экран «не загрузилась», location.replace нет, ровно одно retry-failed', () => {
    const page = createPage()
    stampGuardReload(page, 300)
    page.run()
    const error = new TypeError('Failed to fetch dynamically imported module')
    page.preloadError(error)
    expectFailureScreen(page)
    expect(page.details).toEqual([{ reason: 'retry-failed', kind: 'chunk', error }])
  })

  it('сбой entry (<script type="module" src>) — то же правило: экран, retry-failed с kind entry и url', () => {
    const page = createPage()
    stampGuardReload(page, 300)
    page.run()
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    expectFailureScreen(page)
    expect(page.details).toEqual([{ reason: 'retry-failed', kind: 'entry', url: ENTRY_URL }])
  })

  it('последующие сбои молчат: экран один, событие одно (идемпотентность fail)', () => {
    const page = createPage()
    stampGuardReload(page, 300)
    page.run()
    page.preloadError(new Error('first'))
    page.preloadError(new Error('second'))
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    expectFailureScreen(page)
    expect(page.details).toHaveLength(1)
    expect(page.document.querySelectorAll('[data-sdg-dead-load]')).toHaveLength(1)
  })

  it("граница cooldown — та же, что у guard'а: на возрасте cooldown − 1 мс ещё экран, на самом cooldown — уже автоповтор", () => {
    const inside = createPage()
    stampGuardReload(inside, CHUNK_RELOAD_COOLDOWN_MS - 1)
    inside.run()
    inside.preloadError()
    expectFailureScreen(inside)

    const outside = createPage()
    stampGuardReload(outside, CHUNK_RELOAD_COOLDOWN_MS)
    outside.run()
    outside.preloadError()
    expect(outside.replace).toHaveBeenCalledExactlyOnceWith(
      'https://app.example.com/invite/abc?x=1&sdg-retry=chunk#top',
    )
    expect(requireScreen(outside).dataset.sdgState).toBe('loading')
  })

  it('и штамп, и маркер в URL — один экран и одно событие, не два', () => {
    const page = createPage({ url: 'https://app.example.com/invite/abc?sdg-retry=chunk' })
    stampGuardReload(page, 300)
    page.run()
    page.preloadError(new Error('boom'))
    expectFailureScreen(page)
    expect(page.details).toHaveLength(1)
  })

  it('кнопка «Обновить» — по-прежнему location.reload() (новая загрузка по правилам первой)', () => {
    const page = createPage()
    stampGuardReload(page, 300)
    page.run()
    page.preloadError()
    requireScreen(page).querySelector('button')?.click()
    expect(page.reload).toHaveBeenCalledOnce()
    expect(page.replace).not.toHaveBeenCalled()
  })

  it('watchdog экран гасит: после экрана «не загрузилась» app:load-timeout не приходит', () => {
    vi.useRealTimers()
    vi.useFakeTimers({ now: NOW })
    const page = createPage()
    stampGuardReload(page, 300)
    page.run()
    page.preloadError()
    vi.advanceTimersByTime(120_000)
    expect(page.timeouts).toEqual([])
    expect(page.liveIntervals()).toBe(0)
  })
})

describe('штампа нет или он не про этот документ — автоповтор как раньше', () => {
  it('штамп старше cooldown → первый сбой повторяется с sdg-retry=chunk', () => {
    const page = createPage()
    stampGuardReload(page, CHUNK_RELOAD_COOLDOWN_MS + 5000)
    page.run()
    page.preloadError(new Error('boom'))
    expect(page.replace).toHaveBeenCalledExactlyOnceWith('https://app.example.com/invite/abc?x=1&sdg-retry=chunk#top')
    expect(requireScreen(page).dataset.sdgState).toBe('loading')
    expect(page.details).toEqual([])
  })

  it.each([
    ['пустая строка', ''],
    ['не число', 'вчера'],
    ['NaN', 'NaN'],
    ['ноль', '0'],
  ])('значение штампа — %s → не cooldown, автоповтор', (_name, raw) => {
    const page = createPage()
    page.window.sessionStorage.setItem(CHUNK_RELOAD_COOLDOWN_KEY, raw)
    page.run()
    page.preloadError(new Error('boom'))
    expect(page.replace).toHaveBeenCalledOnce()
    expect(page.details).toEqual([])
  })

  it('чужой ключ в sessionStorage штампом не считается', () => {
    const page = createPage()
    page.window.sessionStorage.setItem('chunk-reload:attempts', JSON.stringify([NOW - 100]))
    page.window.sessionStorage.setItem('nuxt:reload', JSON.stringify({ path: '/invite/abc', expires: NOW + 5000 }))
    page.run()
    page.preloadError(new Error('boom'))
    expect(page.replace).toHaveBeenCalledOnce()
    expect(page.details).toEqual([])
  })

  it('sessionStorage недоступен (SecurityError в WebView) → не cooldown, автоповтор, скрипт не падает', () => {
    const page = createPage()
    Object.defineProperty(page.window, 'sessionStorage', {
      get() {
        throw new Error('SecurityError')
      },
      configurable: true,
    })
    page.run()
    expect(() => page.preloadError(new Error('boom'))).not.toThrow()
    expect(page.replace).toHaveBeenCalledOnce()
    expect(requireScreen(page).dataset.sdgState).toBe('loading')
  })

  it('без сбоя штамп ничего не меняет: ни экрана, ни навигации, ни событий', () => {
    const page = createPage()
    stampGuardReload(page, 300)
    page.run()
    expectNothingHappened(page)
  })
})

describe('штамп не отменяет остальные правила', () => {
  it('после app:mounted скрипт молчит даже при свежем штампе (дальше ведёт guard плагина)', () => {
    const page = createPage()
    stampGuardReload(page, 300)
    page.run()
    page.mounted()
    page.preloadError(new Error('boom'))
    expectNothingHappened(page)
  })

  it('SSR-документ с свежим штампом: сбой по-прежнему молча поглощается — ни экрана, ни события, ни reload', () => {
    const page = createPage({ ssr: true })
    stampGuardReload(page, 300)
    page.run()
    page.preloadError(new Error('boom'))
    expect(page.replace).not.toHaveBeenCalled()
    expect(page.details).toEqual([])
    expect(screenOf(page)).toBeNull()
  })
})
