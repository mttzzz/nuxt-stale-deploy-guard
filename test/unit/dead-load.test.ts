import { afterEach, describe, expect, it } from 'vitest'

import type { RetryFailedBlockedDetail } from '../../src/runtime/chunk-reload-guard'
import { RETRY_MARKER_KEY } from '../../src/runtime/dead-load-bridge'
import {
  closePages,
  createPage,
  ENTRY_URL,
  expectNothingHappened,
  requireScreen,
  screenOf,
} from './helpers/dead-load-page'

/*
 * Поведение inline-скрипта «мёртвая первая загрузка» (Sentry KP-MODMB-COM-1H): сбой чанка/entry ДО `app:mounted`.
 * Первая попытка (в URL нет маркера `sdg-retry`) — оверлей «Загружаем страницу…» и `location.replace` с маркером;
 * повтор (маркер есть) — экран «Страница не загрузилась», кнопка и ровно одно событие `retry-failed`.
 * Страница и шпионы — helpers/dead-load-page.ts; мост для плагина и экран «браузер без import maps» —
 * dead-load-bridge.test.ts; оверлей и текст скрипта — dead-load-screen.test.ts.
 */

afterEach(closePages)

describe('скрипт — до сбоя', () => {
  it('ничего не делает, пока нет сбоя: ни экрана, ни навигации, ни событий', () => {
    const page = createPage()
    page.run()
    expectNothingHappened(page)
  })
})

describe('сбой чанка до монтирования — первая попытка (в URL нет маркера)', () => {
  it('vite:preloadError → оверлей «Загружаем страницу…» и location.replace на тот же URL + sdg-retry=chunk', () => {
    const page = createPage()
    page.run()
    page.preloadError(new TypeError('Failed to fetch dynamically imported module'))
    const root = requireScreen(page)
    expect(root.dataset.sdgState).toBe('loading')
    expect(root.textContent).toBe('Загружаем страницу…')
    expect(page.replace).toHaveBeenCalledExactlyOnceWith('https://app.example.com/invite/abc?x=1&sdg-retry=chunk#top')
  })

  it('«первая попытка» молчит для Sentry: события app:chunk-reload-blocked нет, reload() не зовётся', () => {
    const page = createPage()
    page.run()
    page.preloadError(new Error('boom'))
    expect(page.details).toEqual([])
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('ключ маркера — тот, что убирает плагин после монтирования', () => {
    const page = createPage({ url: 'https://app.example.com/' })
    page.run()
    page.preloadError()
    expect(page.replace).toHaveBeenCalledExactlyOnceWith(`https://app.example.com/?${RETRY_MARKER_KEY}=chunk`)
  })

  it.each([
    ['без query и hash', 'https://app.example.com/invite/abc', 'https://app.example.com/invite/abc?sdg-retry=chunk'],
    [
      'query без hash',
      'https://app.example.com/invite/abc?x=1&y=a%20b',
      'https://app.example.com/invite/abc?x=1&y=a%20b&sdg-retry=chunk',
    ],
    ['только hash', 'https://app.example.com/invite/abc#top', 'https://app.example.com/invite/abc?sdg-retry=chunk#top'],
    [
      'query и hash (hash остаётся ПОСЛЕ маркера)',
      'https://app.example.com/a/b?x=1#sec?not=query',
      'https://app.example.com/a/b?x=1&sdg-retry=chunk#sec?not=query',
    ],
    ['пустой query («?» без параметров)', 'https://app.example.com/a?', 'https://app.example.com/a?sdg-retry=chunk'],
    [
      'похожий ключ не маркер (x-sdg-retry)',
      'https://app.example.com/a?x-sdg-retry=1',
      'https://app.example.com/a?x-sdg-retry=1&sdg-retry=chunk',
    ],
    [
      'порт и кириллица в пути',
      'http://localhost:3000/%D0%BF%D1%83%D1%82%D1%8C?q=1',
      'http://localhost:3000/%D0%BF%D1%83%D1%82%D1%8C?q=1&sdg-retry=chunk',
    ],
  ])('URL: %s', (_name, url, expected) => {
    const page = createPage({ url })
    page.run()
    page.preloadError(new Error('boom'))
    expect(page.replace).toHaveBeenCalledExactlyOnceWith(expected)
    expect(screenOf(page)?.dataset.sdgState).toBe('loading')
  })
})

describe('сбой entry до монтирования', () => {
  it('error <script type="module" src> (ловится в capture на window) → sdg-retry=entry', () => {
    const page = createPage()
    page.run()
    const entry = page.addScript({ type: 'module', src: ENTRY_URL, crossorigin: '' })
    page.failScript(entry)
    expect(page.replace).toHaveBeenCalledExactlyOnceWith('https://app.example.com/invite/abc?x=1&sdg-retry=entry#top')
    expect(requireScreen(page).dataset.sdgState).toBe('loading')
    expect(page.details).toEqual([])
  })

  it('type="module" без учёта регистра тоже entry', () => {
    const page = createPage()
    page.run()
    page.failScript(page.addScript({ type: 'Module', src: ENTRY_URL }))
    expect(page.replace).toHaveBeenCalledExactlyOnceWith('https://app.example.com/invite/abc?x=1&sdg-retry=entry#top')
  })

  it('относительный src в событии — абсолютный адрес скрипта (на повторе он уходит в detail.url)', () => {
    const page = createPage({ url: 'https://app.example.com/invite/abc?sdg-retry=entry' })
    page.run()
    page.failScript(page.addScript({ type: 'module', src: '/_nuxt/entry.abc123.js' }))
    expect(page.details).toEqual([
      { reason: 'retry-failed', kind: 'entry', url: 'https://app.example.com/_nuxt/entry.abc123.js' },
    ])
  })

  it('чужие ошибки загрузки игнорируются: <link> (modulepreload, stylesheet), классический <script src>, не-скрипт с type="module"', () => {
    const page = createPage()
    page.run()
    for (const rel of ['modulepreload', 'stylesheet']) {
      const link = page.document.createElement('link')
      link.setAttribute('rel', rel)
      link.setAttribute('href', '/_nuxt/x.js')
      page.document.head.append(link)
      link.dispatchEvent(new page.window.Event('error'))
    }
    page.failScript(page.addScript({ src: 'https://cdn.example.com/analytics.js' }))
    page.failScript(page.addScript({ type: 'text/javascript', src: 'https://cdn.example.com/other.js' }))
    const embed = page.document.createElement('embed')
    embed.setAttribute('type', 'module')
    embed.setAttribute('src', '/_nuxt/x.js')
    page.document.body.append(embed)
    embed.dispatchEvent(new page.window.Event('error'))
    expectNothingHappened(page)
  })

  it('обычные ошибки выполнения (ErrorEvent на window) — не сбой загрузки', () => {
    const page = createPage()
    page.run()
    page.window.dispatchEvent(
      new page.window.ErrorEvent('error', { message: 'x is not defined', error: new Error('x') }),
    )
    expectNothingHappened(page)
  })
})

describe('сбой на URL с маркером — экран «Страница не загрузилась»', () => {
  const RETRY_URL = 'https://app.example.com/invite/abc?x=1&sdg-retry=chunk#top'

  it('vite:preloadError → экран с заголовком, подсказкой и кнопкой; перезагрузки нет', () => {
    const page = createPage({ url: RETRY_URL })
    page.run()
    page.preloadError(new TypeError('Failed to fetch dynamically imported module'))
    const root = requireScreen(page)
    expect(root.dataset.sdgState).toBe('failed')
    expect(root.querySelector('h1')?.textContent).toBe('Страница не загрузилась')
    expect(root.querySelector('p')?.textContent).toBe('Проверьте подключение к интернету и нажмите «Обновить».')
    const button = root.querySelector('button')
    expect(button?.tagName).toBe('BUTTON')
    expect(button?.getAttribute('type')).toBe('button')
    expect(button?.textContent).toBe('Обновить')
    expect(page.replace).not.toHaveBeenCalled()
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('кнопка «Обновить» → location.reload() (маркер остаётся: одно нажатие = одна попытка)', () => {
    const page = createPage({ url: RETRY_URL })
    page.run()
    page.preloadError(new Error('boom'))
    requireScreen(page).querySelector('button')?.click()
    expect(page.reload).toHaveBeenCalledOnce()
    expect(page.replace).not.toHaveBeenCalled()
  })

  it('chunk: ровно одно событие retry-failed с kind=chunk и исходной ошибкой (по тождеству)', () => {
    const page = createPage({ url: RETRY_URL })
    page.run()
    const error = new TypeError('Failed to fetch dynamically imported module: /_nuxt/invite.js')
    page.preloadError(error)
    expect(page.details).toHaveLength(1)
    const [detail] = page.details as RetryFailedBlockedDetail[]
    expect(detail).toEqual({ reason: 'retry-failed', kind: 'chunk', error })
    expect(detail?.error).toBe(error)
    expect(detail && 'url' in detail).toBe(false)
  })

  it('chunk без payload → событие без ключа error', () => {
    const page = createPage({ url: RETRY_URL })
    page.run()
    page.preloadError()
    expect(page.details).toEqual([{ reason: 'retry-failed', kind: 'chunk' }])
    expect('error' in (page.details[0] as object)).toBe(false)
  })

  it('entry: kind=entry и url упавшего скрипта, без error (событие error скрипта ошибки не несёт)', () => {
    const page = createPage({ url: 'https://app.example.com/invite/abc?sdg-retry=entry' })
    page.run()
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    expect(requireScreen(page).dataset.sdgState).toBe('failed')
    expect(page.details).toEqual([{ reason: 'retry-failed', kind: 'entry', url: ENTRY_URL }])
    expect('error' in (page.details[0] as object)).toBe(false)
    expect(page.replace).not.toHaveBeenCalled()
  })

  it('kind — сбой ТЕКУЩЕЙ загрузки, а не значение маркера (повтор по entry, упал чанк → chunk)', () => {
    const page = createPage({ url: 'https://app.example.com/a?sdg-retry=entry' })
    page.run()
    page.preloadError(new Error('boom'))
    expect(page.details).toEqual([expect.objectContaining({ reason: 'retry-failed', kind: 'chunk' })])
  })

  it.each([
    ['значение chunk', 'https://app.example.com/a?sdg-retry=chunk'],
    ['значение entry', 'https://app.example.com/a?sdg-retry=entry'],
    ['постороннее значение', 'https://app.example.com/a?sdg-retry=foo'],
    ['пустое значение', 'https://app.example.com/a?sdg-retry='],
    ['ключ без значения', 'https://app.example.com/a?sdg-retry'],
    ['маркер не первый параметр', 'https://app.example.com/a?x=1&sdg-retry=chunk&y=2'],
    ['маркер перед hash', 'https://app.example.com/a?sdg-retry=chunk#top'],
  ])('маркер распознан: %s → экран, без replace', (_name, url) => {
    const page = createPage({ url })
    page.run()
    page.preloadError(new Error('boom'))
    expect(requireScreen(page).dataset.sdgState).toBe('failed')
    expect(page.replace).not.toHaveBeenCalled()
    expect(page.details).toHaveLength(1)
  })

  it('маркер в hash — не маркер (это не query страницы)', () => {
    const page = createPage({ url: 'https://app.example.com/a#/x?sdg-retry=chunk' })
    page.run()
    page.preloadError(new Error('boom'))
    expect(page.replace).toHaveBeenCalledOnce()
    expect(requireScreen(page).dataset.sdgState).toBe('loading')
  })
})

describe('один сбой за загрузку страницы', () => {
  it('после первой попытки повторные сбои не дают ни второго replace, ни второго экрана', () => {
    const page = createPage()
    page.run()
    page.preloadError(new Error('first'))
    page.preloadError(new Error('second'))
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    expect(page.replace).toHaveBeenCalledOnce()
    expect(page.document.querySelectorAll('[data-sdg-dead-load]')).toHaveLength(1)
    expect(page.details).toEqual([])
  })

  it('на экране «не загрузилась» повторные сбои не дают второго события и второго экрана', () => {
    const page = createPage({ url: 'https://app.example.com/a?sdg-retry=chunk' })
    page.run()
    const first = new Error('first')
    page.preloadError(first)
    page.preloadError(new Error('second'))
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    expect(page.details).toHaveLength(1)
    expect((page.details[0] as RetryFailedBlockedDetail).error).toBe(first)
    expect(page.document.querySelectorAll('[data-sdg-dead-load]')).toHaveLength(1)
  })
})

describe('location.replace недоступен', () => {
  it('replace бросает → сразу экран «не загрузилась» и событие retry-failed, а не вечный «Загружаем…»', () => {
    const page = createPage({ replaceThrows: true })
    page.run()
    const error = new Error('boom')
    page.preloadError(error)
    expect(page.replace).toHaveBeenCalledOnce()
    expect(requireScreen(page).dataset.sdgState).toBe('failed')
    expect(page.document.querySelectorAll('[data-sdg-dead-load]')).toHaveLength(1)
    expect(page.details).toEqual([{ reason: 'retry-failed', kind: 'chunk', error }])
  })
})
