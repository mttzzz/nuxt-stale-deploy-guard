import type { HTMLElement } from 'happy-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LoadTimeoutDetail } from '../../src/runtime/chunk-reload-guard'
import {
  closePages,
  createPage,
  ENTRY_URL,
  PAGE_URL,
  type Page,
  type PageOptions,
  scriptWithTimeout,
} from './helpers/dead-load-page'

/*
 * Диагностика в detail события `app:load-timeout`: по чему видно, ГДЕ застряла загрузка. Стадия: `network` — не
 * пришли ресурсы документа (есть зависшие критичные ресурсы или документ ещё стримится), `boot` — всё пришло, а
 * приложение не поднялось. Ресурс «завис», если у него нет записи Resource Timing — в тесте это `page.resourceEntries`.
 * Ошибки — первые три ДО монтирования (runtime-`error` на window и `unhandledrejection`). Время и условия, при
 * которых отчёт вообще приходит, — load-timeout.test.ts. Исполняем настоящий текст скрипта в happy-dom.
 */

const TIMEOUT_MS = 30_000
const APP = 'https://app.example.com'
const CDN = 'https://cdn.example.com/_nuxt'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(async () => {
  vi.useRealTimers()
  await closePages()
})

/* Страница с watchdog'ом и готовым содержимым head; скрипт исполнен. */
function startPage(head = '', options: PageOptions = {}): Page {
  const page = createPage({ script: scriptWithTimeout(TIMEOUT_MS), ...options })
  page.document.head.innerHTML = head
  page.run()
  return page
}

/* Доводит видимое время до порога и возвращает единственный отчёт. */
function report(page: Page): LoadTimeoutDetail {
  vi.advanceTimersByTime(TIMEOUT_MS)
  expect(page.timeouts).toHaveLength(1)
  return page.timeouts[0] as LoadTimeoutDetail
}

/* Типичный head Nuxt-страницы: шрифты с чужого хоста, стиль и entry с CDN, polyfills со своего. */
const HEAD = `
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope&display=swap">
  <link rel="stylesheet" href="${CDN}/entry.css">
  <link rel="modulepreload" href="${CDN}/entry.js">
  <script src="/legacy-polyfills.js"></script>
  <script type="module" src="${CDN}/entry.js"></script>
`
const HEAD_RESOURCES = [
  'https://fonts.googleapis.com/css2?family=Manrope&display=swap',
  `${CDN}/entry.css`,
  `${CDN}/entry.js`,
  `${APP}/legacy-polyfills.js`,
]

describe('диагностика — стадия network: не пришли ресурсы', () => {
  it('завис стиль из head: network, host — хост зависшего ресурса, pending без query', () => {
    const page = startPage(HEAD, { readyState: 'loading' })
    page.resourceEntries.push(...HEAD_RESOURCES.slice(1))

    expect(report(page)).toEqual({
      reason: 'load-timeout',
      timeoutMs: TIMEOUT_MS,
      visibleMs: TIMEOUT_MS,
      hiddenMs: 0,
      elapsedMs: TIMEOUT_MS,
      url: PAGE_URL,
      stage: 'network',
      host: 'fonts.googleapis.com',
      readyState: 'loading',
      online: true,
      pending: ['fonts.googleapis.com/css2'],
      pendingCount: 1,
      criticalCount: 5,
      vueMounted: false,
      errors: [],
    })
  })

  it('есть зависший ресурс — network, даже когда документ уже разобран (readyState interactive)', () => {
    const page = startPage(HEAD, { readyState: 'interactive' })
    page.resourceEntries.push(...HEAD_RESOURCES.slice(0, 3))

    expect(report(page)).toMatchObject({
      stage: 'network',
      host: 'app.example.com',
      pending: ['app.example.com/legacy-polyfills.js'],
      pendingCount: 1,
    })
  })

  it('документ ещё стримится (readyState loading), зависших ресурсов нет: network, host — location.host с портом', () => {
    const page = startPage('', { url: 'https://app.example.com:8443/invite/abc?x=1#top', readyState: 'loading' })

    expect(report(page)).toMatchObject({
      stage: 'network',
      host: 'app.example.com:8443',
      readyState: 'loading',
      pending: [],
      pendingCount: 0,
      criticalCount: 0,
    })
  })

  it('зависших больше пяти: в detail первые пять в порядке документа, pendingCount и criticalCount — полные', () => {
    const styles = [1, 2, 3, 4, 5, 6].map(
      (n) => `<link rel="stylesheet" href="https://s${n}.example.com/css/${n}.css?v=${n}#x">`,
    )
    const page = startPage(
      [
        '<script src="https://cdn.example.com:8443/first.js?v=1"></script>',
        ...styles,
        '<link rel="stylesheet" href="https://loaded.example.com/ok.css">',
      ].join('\n'),
    )
    page.resourceEntries.push('https://loaded.example.com/ok.css')

    expect(report(page)).toMatchObject({
      stage: 'network',
      host: 'cdn.example.com:8443',
      pending: [
        'cdn.example.com:8443/first.js',
        's1.example.com/css/1.css',
        's2.example.com/css/2.css',
        's3.example.com/css/3.css',
        's4.example.com/css/4.css',
      ],
      pendingCount: 7,
      criticalCount: 8,
    })
  })

  it('длинный путь зависшего ресурса обрезается до 120 символов', () => {
    const page = startPage(`<script src="https://cdn.example.com/${'x'.repeat(300)}.js"></script>`)

    const { pending } = report(page)

    expect(pending).toHaveLength(1)
    expect(pending[0]).toBe(`cdn.example.com/${'x'.repeat(104)}`)
  })

  it.each([
    ['unsupported', 'interactive', 'boot'],
    ['throws', 'interactive', 'boot'],
    ['throws', 'loading', 'network'],
  ] as const)(
    'Resource Timing недоступен (%s), readyState %s: pending пуст, criticalCount считается, стадия %s',
    (resourceTiming, readyState, stage) => {
      const page = startPage(HEAD, { resourceTiming, readyState })

      expect(report(page)).toMatchObject({ stage, pending: [], pendingCount: 0, criticalCount: 5 })
    },
  )
})

describe('диагностика — стадия boot: всё пришло, приложение не поднялось', () => {
  it('нет зависших и документ разобран: boot без host, с ошибками старта', () => {
    const page = startPage(HEAD, { readyState: 'complete' })
    page.resourceEntries.push(...HEAD_RESOURCES)
    page.runtimeError({
      message: "Uncaught TypeError: Cannot read properties of undefined (reading 'use')",
      filename: `${CDN}/entry.js?v=7`,
      lineno: 1,
      colno: 40_213,
    })
    page.rejection(new Error('Hydration failed'))

    const detail = report(page)

    expect(detail).toEqual({
      reason: 'load-timeout',
      timeoutMs: TIMEOUT_MS,
      visibleMs: TIMEOUT_MS,
      hiddenMs: 0,
      elapsedMs: TIMEOUT_MS,
      url: PAGE_URL,
      stage: 'boot',
      readyState: 'complete',
      online: true,
      pending: [],
      pendingCount: 0,
      criticalCount: 5,
      vueMounted: false,
      errors: [
        {
          message: "Uncaught TypeError: Cannot read properties of undefined (reading 'use')",
          source: 'cdn.example.com/_nuxt/entry.js:1:40213',
        },
        { message: 'Hydration failed' },
      ],
    })
    expect(detail).not.toHaveProperty('host')
  })

  it('Vue смонтирован ([data-v-app]), а mounted() плагин не вызвал: vueMounted true', () => {
    const page = startPage('', { readyState: 'complete' })
    page.document.querySelector<HTMLElement>('#__nuxt')!.dataset.vApp = ''

    expect(report(page)).toMatchObject({ stage: 'boot', vueMounted: true })
  })
})

describe('диагностика — какие ресурсы критичны', () => {
  /* У каждого ресурса нет записи Resource Timing: будь он критичным, он значился бы зависшим. */
  it.each([
    ['prefetch', `<link rel="prefetch" as="script" href="${CDN}/page.js">`],
    ['preload', `<link rel="preload" as="script" href="${CDN}/page.js">`],
    ['icon', '<link rel="icon" href="/favicon.ico">'],
    ['preconnect', '<link rel="preconnect" href="https://fonts.gstatic.com">'],
    ['альтернативный стиль', '<link rel="alternate stylesheet" href="/alt.css">'],
    ['отключённый стиль', '<link rel="stylesheet" href="/off.css" disabled>'],
    ['стиль для печати (media не подходит)', '<link rel="stylesheet" href="/print.css" media="print">'],
    ['классический async-скрипт', '<script async src="https://analytics.example.com/a.js"></script>'],
  ])('не критичен: %s', (_name, markup) => {
    const page = startPage(markup)

    expect(report(page)).toMatchObject({ stage: 'boot', pending: [], pendingCount: 0, criticalCount: 0 })
  })

  it.each([
    ['стиль', '<link rel="stylesheet" href="/a.css">', 'app.example.com/a.css'],
    ['стиль с подходящим media', '<link rel="stylesheet" href="/a.css" media="screen">', 'app.example.com/a.css'],
    ['modulepreload', `<link rel="modulepreload" href="${CDN}/a.js">`, 'cdn.example.com/_nuxt/a.js'],
    ['синхронный скрипт', '<script src="/a.js"></script>', 'app.example.com/a.js'],
    ['defer-скрипт', '<script defer src="/a.js"></script>', 'app.example.com/a.js'],
    ['module-скрипт', `<script type="module" src="${CDN}/a.js"></script>`, 'cdn.example.com/_nuxt/a.js'],
    ['module-скрипт с async', `<script type="module" async src="${CDN}/a.js"></script>`, 'cdn.example.com/_nuxt/a.js'],
  ])('критичен: %s', (_name, markup, pending) => {
    const page = startPage(markup)

    expect(report(page)).toMatchObject({ stage: 'network', pending: [pending], pendingCount: 1, criticalCount: 1 })
  })
})

describe('диагностика — online, readyState на момент отчёта', () => {
  it('online — navigator.onLine на момент отчёта', () => {
    const page = startPage()
    page.setOnline(false)

    expect(report(page).online).toBe(false)
  })

  it('у navigator нет onLine — считаем, что сеть есть', () => {
    const page = startPage()
    Object.defineProperty(page.window.navigator, 'onLine', { value: undefined, configurable: true })

    expect(report(page).online).toBe(true)
  })

  it('readyState читается в момент отчёта, а не при старте скрипта', () => {
    const page = startPage('', { readyState: 'loading' })
    page.setReadyState('complete')

    expect(report(page)).toMatchObject({ readyState: 'complete', stage: 'boot' })
  })
})

describe('диагностика — ошибки до монтирования', () => {
  it('первые три: message обрезан до 200, source — host + путь:строка:колонка без query и hash', () => {
    const page = startPage()
    page.runtimeError({ message: 'x'.repeat(500), filename: `${CDN}/entry.abc123.js?v=1#top`, lineno: 12, colno: 34 })
    page.runtimeError({ message: 'Script error.' })
    page.runtimeError({ message: 'inline', filename: `${APP}/invite/abc?x=1`, lineno: 3, colno: 4 })
    page.runtimeError({ message: 'четвёртая' })
    page.rejection(new Error('пятая'))

    expect(report(page).errors).toEqual([
      { message: 'x'.repeat(200), source: 'cdn.example.com/_nuxt/entry.abc123.js:12:34' },
      { message: 'Script error.' },
      { message: 'inline', source: 'app.example.com/invite/abc:3:4' },
    ])
  })

  it('unhandledrejection и runtime-ошибки делят один лимит в три записи, в порядке прихода', () => {
    const page = startPage()
    page.rejection(new Error('первая'))
    page.runtimeError({ message: 'вторая' })
    page.rejection('третья')
    page.rejection(new Error('четвёртая'))

    expect(report(page).errors).toEqual([{ message: 'первая' }, { message: 'вторая' }, { message: 'третья' }])
  })

  it.each([
    ['Error с message', new Error('boom'), 'boom'],
    ['строка', 'plain text', 'plain text'],
    ['объект без message', { code: 5 }, '[object Object]'],
    ['message не строка', { message: 42 }, '[object Object]'],
    ['undefined', undefined, 'undefined'],
    ['объект, не приводимый к строке', Object.create(null), 'unknown'],
    ['длинное сообщение', new Error('y'.repeat(500)), 'y'.repeat(200)],
  ])('unhandledrejection: %s', (_name, reason, message) => {
    const page = startPage()
    page.rejection(reason)

    expect(report(page).errors).toEqual([{ message }])
  })

  it('сбои загрузки элементов (стиль, обычный скрипт, картинка) — не runtime-ошибки: в errors не попадают', () => {
    const page = startPage(
      '<link rel="stylesheet" href="https://fonts.googleapis.com/css2"><script src="/legacy-polyfills.js"></script>',
    )
    page.failScript(page.document.querySelector('link')!)
    page.failScript(page.document.querySelector('script')!)
    page.failScript(page.document.createElement('img'))

    expect(report(page).errors).toEqual([])
  })

  it('сбой module-скрипта entry — канал entry (автоповтор), а не ошибка: kind есть, errors пуст', () => {
    const page = startPage()
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))

    expect(report(page)).toMatchObject({ kind: 'entry', errors: [] })
  })

  it('ошибка, пришедшая после отчёта, в уже отправленный detail не попадает', () => {
    const page = startPage()
    page.runtimeError({ message: 'до отчёта' })
    const detail = report(page)

    page.runtimeError({ message: 'после отчёта' })

    expect(detail.errors).toEqual([{ message: 'до отчёта' }])
  })
})

describe('диагностика — устойчивость', () => {
  it('сбой чтения DOM не съедает отчёт: время и стадия по readyState уходят', () => {
    const page = startPage('', { readyState: 'loading' })
    Object.defineProperty(page.document, 'querySelectorAll', {
      value: () => {
        throw new Error('boom')
      },
      configurable: true,
    })

    expect(report(page)).toMatchObject({
      reason: 'load-timeout',
      visibleMs: TIMEOUT_MS,
      stage: 'network',
      host: 'app.example.com',
      pending: [],
      pendingCount: 0,
      criticalCount: 0,
    })
  })
})
