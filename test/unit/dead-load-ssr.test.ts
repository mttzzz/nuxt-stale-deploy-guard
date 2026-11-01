import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LoadTimeoutDetail } from '../../src/runtime/chunk-reload-guard'
import { DEAD_LOAD_GLOBAL, SSR_MARKER_ATTR } from '../../src/runtime/dead-load-bridge'
import {
  closePages,
  createPage,
  ENTRY_URL,
  expectNothingHappened,
  PAGE_URL,
  requireScreen,
  type Page,
  type PageOptions,
  scriptWithTimeout,
} from './helpers/dead-load-page'

/*
 * Документ, ОТРЕНДЕРЕННЫЙ на сервере (на `<html>` метка `data-sdg-ssr`, её ставит серверный плагин модуля): страница не
 * мертва — содержимое уже в HTML и читается, обычные ссылки работают без JS. Оверлей или перезагрузка спрятали бы
 * работающую страницу, поэтому inline-скрипт «мёртвая первая загрузка» на таком документе:
 *   - `fail()` не рисует оверлей, не зовёт `location.replace` и не шлёт `app:chunk-reload-blocked` — только помечает
 *     документ пережившим сбой (`handled()` → true, клиентский плагин молчит);
 *   - watchdog шлёт `app:load-timeout` лишь если среди зависших критичных ресурсов есть стиль (без него отрисовка
 *     заблокирована, страница действительно пуста), иначе молча останавливается.
 * Документ без метки (SPA-оболочка) ведёт себя как раньше — это проверяют остальные тесты скрипта; здесь — только
 * переключатель и сама метка. Исполняем настоящий текст скрипта в happy-dom; время — fake timers (см. helper).
 */

const TIMEOUT_MS = 30_000
const CDN = 'https://cdn.example.com/_nuxt'
const ENTRY_JS = `${CDN}/entry.js`
const ENTRY_CSS = `${CDN}/entry.css`
const PAGE_JS = `${CDN}/page.js`

/* Скрипты первой загрузки: entry и чанк страницы — без них приложение не стартует, но содержимое документа читается. */
const SCRIPTS = `<script type="module" src="${ENTRY_JS}"></script><link rel="modulepreload" href="${PAGE_JS}">`
/* Тот же head со стилем: пока он не пришёл, отрисовка заблокирована. */
const STYLE_AND_SCRIPTS = `<link rel="stylesheet" href="${ENTRY_CSS}">${SCRIPTS}`

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  /* Сначала реальные таймеры: happy-dom при закрытии окна ждёт завершения задач. */
  vi.useRealTimers()
  await closePages()
})

interface Bridge {
  fail: (kind: string, error?: unknown, url?: string) => void
  mounted: () => void
  handled: () => boolean
}

function bridgeOf(page: Page): Bridge {
  return Reflect.get(page.window, DEAD_LOAD_GLOBAL) as Bridge
}

/* SSR-страница с watchdog'ом и готовым содержимым head; скрипт исполнен. */
function startPage(head = '', options: PageOptions = {}): Page {
  const page = createPage({ script: scriptWithTimeout(TIMEOUT_MS), ssr: true, ...options })
  page.document.head.innerHTML = head
  page.run()
  return page
}

/* Единственный отчёт страницы. */
function onlyReport(page: Page): LoadTimeoutDetail {
  expect(page.timeouts).toHaveLength(1)
  return page.timeouts[0] as LoadTimeoutDetail
}

/* Каналы pre-mount сбоя: события window, ошибка entry и мост клиентского плагина. */
const FAILURES: [string, (page: Page) => void][] = [
  [
    'vite:preloadError',
    (page) => {
      page.preloadError(new TypeError('Failed to fetch dynamically imported module'))
    },
  ],
  [
    'error <script type="module" src> (entry)',
    (page) => {
      page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    },
  ],
  [
    "мост fail('chunk', error)",
    (page) => {
      bridgeOf(page).fail('chunk', new Error('boom'))
    },
  ],
  [
    "мост fail('entry', undefined, url)",
    (page) => {
      bridgeOf(page).fail('entry', undefined, ENTRY_URL)
    },
  ],
]

describe('SSR-документ — сбой чанка или entry до монтирования: содержимое не трогаем', () => {
  describe.each([
    ['первая попытка (в URL нет sdg-retry)', PAGE_URL],
    ['повтор (в URL уже есть sdg-retry)', 'https://app.example.com/a?sdg-retry=entry'],
  ])('%s', (_name, url) => {
    it.each(FAILURES)('%s → ни оверлея, ни replace, ни reload, ни события', (_channel, trigger) => {
      const page = createPage({ ssr: true, url })
      page.run()
      trigger(page)
      expectNothingHappened(page)
    })
  })

  it('все каналы подряд: ни первый сбой, ни последующие ничего не рисуют, не навигируют и не сообщают', () => {
    const page = createPage({ ssr: true })
    page.run()
    for (const [, trigger] of FAILURES) {
      trigger(page)
    }
    expectNothingHappened(page)
    expect(page.document.querySelectorAll('[data-sdg-dead-load]')).toHaveLength(0)
  })

  it('поглощённый сбой помечает документ пережившим сбой: handled() → true, и так остаётся после mounted()', () => {
    const page = createPage({ ssr: true })
    page.run()
    expect(bridgeOf(page).handled()).toBe(false)

    page.preloadError(new Error('boom'))
    expect(bridgeOf(page).handled()).toBe(true)

    bridgeOf(page).mounted()
    expect(bridgeOf(page).handled()).toBe(true)
    expectNothingHappened(page)
  })

  it('сбой после mounted() скрипт не обрабатывает: документ не «пережил сбой», handled() — false', () => {
    const page = createPage({ ssr: true })
    page.run()
    bridgeOf(page).mounted()
    page.preloadError(new Error('boom'))
    expectNothingHappened(page)
    expect(bridgeOf(page).handled()).toBe(false)
  })

  it('тот же сбой на документе без метки: оверлей «Загружаем страницу…» и replace — метка и есть переключатель', () => {
    const page = createPage()
    page.run()
    page.preloadError(new Error('boom'))
    expect(requireScreen(page).dataset.sdgState).toBe('loading')
    expect(page.replace).toHaveBeenCalledOnce()
  })
})

describe('SSR-документ — watchdog «приложение не загрузилось»', () => {
  it('зависли только скрипты (entry и чанк): отчёта нет, интервал остановлен — содержимое читается', () => {
    const page = startPage(SCRIPTS)

    vi.advanceTimersByTime(TIMEOUT_MS)
    expect(page.timeouts).toEqual([])
    expect(page.liveIntervals()).toBe(0)

    vi.advanceTimersByTime(TIMEOUT_MS * 3)
    expect(page.timeouts).toEqual([])
  })

  it('завис стиль (скрипты пришли): ровно один отчёт — стадия network, зависший ресурс — стиль', () => {
    const page = startPage(STYLE_AND_SCRIPTS)
    page.resourceEntries.push(ENTRY_JS, PAGE_JS)

    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(onlyReport(page)).toMatchObject({
      reason: 'load-timeout',
      timeoutMs: TIMEOUT_MS,
      visibleMs: TIMEOUT_MS,
      stage: 'network',
      host: 'cdn.example.com',
      pending: ['cdn.example.com/_nuxt/entry.css'],
      pendingCount: 1,
      criticalCount: 3,
    })
    expect(page.liveIntervals()).toBe(0)
  })

  it('зависли и стиль, и скрипты: отчёт один, в нём все зависшие ресурсы в порядке документа', () => {
    const page = startPage(STYLE_AND_SCRIPTS)

    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(onlyReport(page)).toMatchObject({
      stage: 'network',
      pending: ['cdn.example.com/_nuxt/entry.css', 'cdn.example.com/_nuxt/entry.js', 'cdn.example.com/_nuxt/page.js'],
      pendingCount: 3,
    })
  })

  it('стиль пришёл, скрипты зависли: тишина — отрисовка не заблокирована', () => {
    const page = startPage(STYLE_AND_SCRIPTS)
    page.resourceEntries.push(ENTRY_CSS)

    vi.advanceTimersByTime(TIMEOUT_MS * 2)

    expect(page.timeouts).toEqual([])
  })

  it('зависшие стили, которые отрисовку не блокируют (alternate, disabled, media для печати): тишина', () => {
    const page = startPage(
      `<link rel="alternate stylesheet" href="/alt.css">
       <link rel="stylesheet" href="/off.css" disabled>
       <link rel="stylesheet" href="/print.css" media="print">${SCRIPTS}`,
    )

    vi.advanceTimersByTime(TIMEOUT_MS * 2)

    expect(page.timeouts).toEqual([])
  })

  it('стиль — за пределами первых пяти зависших: в detail он не попал, но отчёт уходит (учитываются все зависшие)', () => {
    const scripts = [1, 2, 3, 4, 5, 6].map((n) => `<script src="https://s${n}.example.com/${n}.js"></script>`)
    const page = startPage(`${scripts.join('')}<link rel="stylesheet" href="${ENTRY_CSS}">`)

    vi.advanceTimersByTime(TIMEOUT_MS)

    const detail = onlyReport(page)
    expect(detail.pendingCount).toBe(7)
    expect(detail.pending).toHaveLength(5)
    expect(detail.pending).not.toContain('cdn.example.com/_nuxt/entry.css')
  })

  it.each(['unsupported', 'throws'] as const)(
    'Resource Timing недоступен (%s): зависших не определить, pending пуст — стиль в head не повод для отчёта',
    (resourceTiming) => {
      const page = startPage(STYLE_AND_SCRIPTS, { resourceTiming })

      vi.advanceTimersByTime(TIMEOUT_MS * 2)

      expect(page.timeouts).toEqual([])
    },
  )

  it('DOM не читается (querySelectorAll бросает): зависший стиль не доказать — тишина', () => {
    const page = startPage(STYLE_AND_SCRIPTS)
    Object.defineProperty(page.document, 'querySelectorAll', {
      value: () => {
        throw new Error('boom')
      },
      configurable: true,
    })

    vi.advanceTimersByTime(TIMEOUT_MS * 2)

    expect(page.timeouts).toEqual([])
  })

  it('поглощённый сбой entry + только скрипты зависли: тишина — ни события сбоя, ни отчёта', () => {
    const page = startPage(SCRIPTS)
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))

    vi.advanceTimersByTime(TIMEOUT_MS * 2)

    expect(page.timeouts).toEqual([])
    expectNothingHappened(page)
  })

  it('поглощённый сбой entry + завис стиль (страница пуста): отчёт уходит с kind сбоя, события сбоя по-прежнему нет', () => {
    const page = startPage(STYLE_AND_SCRIPTS)
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))

    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(onlyReport(page)).toMatchObject({ kind: 'entry', stage: 'network' })
    expectNothingHappened(page)
  })

  it('приложение смонтировалось до порога: отчёта нет, даже когда стиль так и не пришёл', () => {
    const page = startPage(STYLE_AND_SCRIPTS)
    vi.advanceTimersByTime(10_000)

    page.mounted()
    vi.advanceTimersByTime(TIMEOUT_MS * 2)

    expect(page.timeouts).toEqual([])
  })

  it('тот же head на документе без метки: зависли только скрипты → отчёт уходит, как раньше', () => {
    const page = startPage(SCRIPTS, { ssr: false })

    vi.advanceTimersByTime(TIMEOUT_MS)

    expect(onlyReport(page)).toMatchObject({ stage: 'network', pendingCount: 2 })
  })
})

describe('метка читается один раз, при старте скрипта', () => {
  it('метку сняли после старта (другой код переписал <html>) → сбой всё равно поглощён', () => {
    const page = createPage({ ssr: true })
    page.run()

    page.document.documentElement.removeAttribute(SSR_MARKER_ATTR)
    page.preloadError(new Error('boom'))

    expectNothingHappened(page)
  })

  it('метку поставили после старта на документе без метки → прежнее поведение: автоповтор', () => {
    const page = createPage()
    page.run()

    page.document.documentElement.setAttribute(SSR_MARKER_ATTR, '')
    page.preloadError(new Error('boom'))

    expect(page.replace).toHaveBeenCalledOnce()
    expect(requireScreen(page).dataset.sdgState).toBe('loading')
  })

  it('значение атрибута не важно: data-sdg-ssr="1" — тоже метка', () => {
    const page = createPage()
    page.document.documentElement.setAttribute(SSR_MARKER_ATTR, '1')
    page.run()

    page.preloadError(new Error('boom'))

    expectNothingHappened(page)
  })

  it('метка — на <html>: тот же атрибут на <body> ничего не значит', () => {
    const page = createPage()
    page.document.body.setAttribute(SSR_MARKER_ATTR, '')
    page.run()

    page.preloadError(new Error('boom'))

    expect(page.replace).toHaveBeenCalledOnce()
  })
})
