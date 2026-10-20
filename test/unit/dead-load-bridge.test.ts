import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEAD_LOAD_SCRIPT } from '../../src/runtime/dead-load'
import { DEAD_LOAD_GLOBAL } from '../../src/runtime/dead-load-bridge'
import { IMPORTMAP_CHECK_SCRIPT } from '../../src/runtime/importmap-check'
import {
  closePages,
  createPage,
  ENTRY_URL,
  expectNothingHappened,
  type Page,
  type PageOptions,
  requireScreen,
  screenOf,
} from './helpers/dead-load-page'

/*
 * Мост скрипта «мёртвая первая загрузка» к клиентскому плагину (`window.__sdgDeadLoad`: `fail()` и `mounted()`) и
 * взаимодействие с экраном «браузер без import maps»: если importmap-check взял страницу (`window.stop()`),
 * dead-load не делает ничего — ни повтора, ни второго экрана, ни `retry-failed`.
 */

afterEach(closePages)

interface Bridge {
  fail: (kind: string, error?: unknown, url?: string) => void
  mounted: () => void
}

function bridgeOf(page: Page): Bridge {
  return Reflect.get(page.window, DEAD_LOAD_GLOBAL) as Bridge
}

describe('мост fail() и mounted() для клиентского плагина', () => {
  it('скрипт кладёт в window мост с fail() и mounted() под именем из контракта плагина', () => {
    const page = createPage()
    page.run()
    const bridge = bridgeOf(page)
    expect(typeof bridge.fail).toBe('function')
    expect(typeof bridge.mounted).toBe('function')
  })

  it("fail('chunk', error) на URL без маркера → тот же повтор, что и по vite:preloadError", () => {
    const page = createPage()
    page.run()
    bridgeOf(page).fail('chunk', new Error('boom'))
    expect(page.replace).toHaveBeenCalledExactlyOnceWith('https://app.example.com/invite/abc?x=1&sdg-retry=chunk#top')
    expect(requireScreen(page).dataset.sdgState).toBe('loading')
  })

  it("fail('chunk', error) на URL с маркером → экран и событие с исходной ошибкой", () => {
    const page = createPage({ url: 'https://app.example.com/a?sdg-retry=chunk' })
    page.run()
    const error = new Error("Couldn't resolve component")
    bridgeOf(page).fail('chunk', error)
    expect(page.details).toEqual([{ reason: 'retry-failed', kind: 'chunk', error }])
  })

  it("fail('entry', undefined, url) передаёт kind и url", () => {
    const page = createPage({ url: 'https://app.example.com/a?sdg-retry=entry' })
    page.run()
    bridgeOf(page).fail('entry', undefined, ENTRY_URL)
    expect(page.details).toEqual([{ reason: 'retry-failed', kind: 'entry', url: ENTRY_URL }])
  })

  it('неизвестный kind считается chunk: в адрес не попадает произвольный текст', () => {
    const page = createPage({ url: 'https://app.example.com/a' })
    page.run()
    bridgeOf(page).fail('"><script>')
    expect(page.replace).toHaveBeenCalledExactlyOnceWith('https://app.example.com/a?sdg-retry=chunk')
  })

  it('mounted() → дальше скрипт ни на что не реагирует (ни vite:preloadError, ни entry, ни fail)', () => {
    const page = createPage()
    page.run()
    bridgeOf(page).mounted()
    page.preloadError(new Error('boom'))
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    bridgeOf(page).fail('chunk', new Error('boom'))
    expectNothingHappened(page)
  })

  it('mounted() на экране «не загрузилась» экран не убирает (приложение могло показать страницу ошибки Nuxt)', () => {
    const page = createPage({ url: 'https://app.example.com/a?sdg-retry=chunk' })
    page.run()
    page.preloadError(new Error('boom'))
    bridgeOf(page).mounted()
    expect(requireScreen(page).dataset.sdgState).toBe('failed')
    expect(page.details).toHaveLength(1)
  })
})

/* Страница прод-сборки: import map в head, `supports('importmap')` ложно — importmap-check остановит загрузку. */
function createUnsupportedPage(options: PageOptions = {}) {
  const page = createPage(options)
  page.document.head.innerHTML = '<script type="importmap">{"imports":{"#entry":"/_nuxt/entry.js"}}</script>'
  Object.defineProperty(page.window.HTMLScriptElement, 'supports', { value: () => false, configurable: true })
  Object.defineProperty(page.window, 'stop', { value: vi.fn(), configurable: true })
  return page
}

describe('экран «браузер без import maps» уже взял страницу', () => {
  const UNSUPPORTED_EVENT = { reason: 'unsupported-browser', missing: 'importmap' }
  /* Порядок в HTML: dead-load — в head, importmap-check — в bodyClose. */
  const SCRIPTS_IN_HTML_ORDER = [DEAD_LOAD_SCRIPT, IMPORTMAP_CHECK_SCRIPT]

  it('dead-load (head) → importmap-check (bodyClose) → window.stop() → error оборванного entry: тишина', () => {
    const page = createUnsupportedPage()
    for (const script of SCRIPTS_IN_HTML_ORDER) {
      page.window.eval(script)
    }
    expect(page.document.querySelector('[data-sdg-unsupported]')).not.toBeNull()
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    page.preloadError(new Error('Module specifier, \'#entry\' does not start with "/"'))
    expect(page.replace).not.toHaveBeenCalled()
    expect(screenOf(page)).toBeNull()
    expect(page.details).toEqual([UNSUPPORTED_EVENT])
  })

  it('порядок скриптов не опора: importmap-check раньше dead-load — всё равно тишина', () => {
    const page = createUnsupportedPage()
    for (const script of SCRIPTS_IN_HTML_ORDER.toReversed()) {
      page.window.eval(script)
    }
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    expect(page.replace).not.toHaveBeenCalled()
    expect(screenOf(page)).toBeNull()
    expect(page.details).toEqual([UNSUPPORTED_EVENT])
  })

  it('даже на URL с маркером: ни экрана «не загрузилась», ни retry-failed', () => {
    const page = createUnsupportedPage({ url: 'https://app.example.com/a?sdg-retry=entry' })
    for (const script of SCRIPTS_IN_HTML_ORDER) {
      page.window.eval(script)
    }
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    expect(screenOf(page)).toBeNull()
    expect(page.details).toEqual([UNSUPPORTED_EVENT])
  })

  it('поддерживаемый браузер: importmap-check молчит и dead-load работает как обычно', () => {
    const page = createUnsupportedPage()
    Object.defineProperty(page.window.HTMLScriptElement, 'supports', { value: () => true, configurable: true })
    for (const script of SCRIPTS_IN_HTML_ORDER) {
      page.window.eval(script)
    }
    page.failScript(page.addScript({ type: 'module', src: ENTRY_URL }))
    expect(page.replace).toHaveBeenCalledOnce()
    expect(requireScreen(page).dataset.sdgState).toBe('loading')
  })
})
