import { parse } from 'acorn'
import { type HTMLElement, Window } from 'happy-dom'
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest'

import type { UnsupportedBrowserBlockedDetail } from '../../src/runtime/chunk-reload-guard'
import { IMPORTMAP_CHECK_SCRIPT } from '../../src/runtime/importmap-check'

/*
 * Поведение inline-скрипта «браузер без import maps» (прод-инцидент ai.pushka.biz 15.10.2026: iOS 16.0.2 →
 * `500 Module specifier '#entry'`). Исполняем ИТОГОВУЮ строку скрипта в изолированном happy-dom-окне — ровно тот
 * текст, который модуль кладёт в `app.head.script` (bodyClose). Экран ищем по маркерам из контракта:
 * корневой элемент несёт `data-sdg-unsupported`, кнопка — настоящий `<button type="button">`.
 */

const PAGE_URL = 'https://app.example.com/invite/abc?x=1'
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Safari/605.1.15'
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const UNSUPPORTED_DETAIL: UnsupportedBrowserBlockedDetail = { reason: 'unsupported-browser', missing: 'importmap' }

const DARK = { bg: '#1d161e', accent: '#c084fc' }
const LIGHT = { bg: '#ffffff', accent: '#9333ea' }

interface PageOptions {
  /* На странице есть `<script type="importmap">` (Nuxt 4.1+). */
  importMap?: boolean
  /* Ответ `HTMLScriptElement.supports('importmap')`; 'missing' — метода нет вовсе (Safari < 16). */
  supports?: boolean | 'missing'
  userAgent?: string
  maxTouchPoints?: number
  /* Класс на <html>: `light`/`dark` ставит @nuxtjs/color-mode. */
  htmlClass?: string
  prefersLight?: boolean
  /* Метод navigator.clipboard.writeText: резолвится, отклоняется или самого API нет. */
  clipboard?: 'resolves' | 'rejects' | 'missing'
  /* Метод document.execCommand('copy'): что вернул; 'missing' — метода нет (в happy-dom его нет по умолчанию). */
  execCommand?: boolean | 'missing'
  /* Метод window.stop: нормально, бросает или отсутствует. */
  stop?: 'ok' | 'throws' | 'missing'
}

/* Страница с подставленными «браузерными» API и шпионами; `run()` исполняет скрипт как при парсинге. */
interface Page {
  window: Window
  document: Window['document']
  /* Detail каждого события `app:chunk-reload-blocked`, по порядку. */
  details: unknown[]
  /* Порядок «событие → stop» — часть контракта: слушатель успевает собрать отчёт до остановки парсера. */
  order: string[]
  writeText: Mock<(text: string) => Promise<void>>
  execCommand: Mock<(command: string) => boolean>
  stop: Mock<() => void>
  supports: Mock<(type: string) => boolean>
  run: () => void
}

const openPages: Window[] = []

function createPage(options: PageOptions = {}): Page {
  const {
    importMap = true,
    supports = false,
    userAgent = WINDOWS_UA,
    maxTouchPoints = 0,
    htmlClass = '',
    prefersLight = false,
    clipboard = 'resolves',
    execCommand = 'missing',
    stop = 'ok',
  } = options

  const window = new Window({
    url: PAGE_URL,
    settings: { navigator: { userAgent }, device: { prefersColorScheme: prefersLight ? 'light' : 'dark' } },
  })
  openPages.push(window)
  const { document } = window
  document.documentElement.className = htmlClass
  if (importMap) {
    document.head.innerHTML = '<script type="importmap">{"imports":{"#entry":"/_nuxt/entry.js"}}</script>'
  }
  document.body.innerHTML = '<div id="__nuxt"></div>'

  const supportsSpy = vi.fn((type: string) => type === 'importmap' && supports === true)
  Object.defineProperty(window.HTMLScriptElement, 'supports', {
    value: supports === 'missing' ? undefined : supportsSpy,
    configurable: true,
  })
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true })

  const writeText = vi.fn((_text: string) =>
    clipboard === 'rejects' ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(),
  )
  Object.defineProperty(window.navigator, 'clipboard', {
    value: clipboard === 'missing' ? undefined : { writeText },
    configurable: true,
  })
  const execCommandSpy = vi.fn((_command: string) => execCommand === true)
  if (execCommand !== 'missing') {
    Object.defineProperty(document, 'execCommand', { value: execCommandSpy, configurable: true })
  }

  const order: string[] = []
  const stopSpy = vi.fn(() => {
    order.push('stop')
    if (stop === 'throws') {
      throw new Error('stop failed')
    }
  })
  Object.defineProperty(window, 'stop', { value: stop === 'missing' ? undefined : stopSpy, configurable: true })

  const details: unknown[] = []
  window.addEventListener('app:chunk-reload-blocked', (event) => {
    order.push('event')
    details.push('detail' in event ? event.detail : undefined)
  })

  return {
    window,
    document,
    details,
    order,
    writeText,
    execCommand: execCommandSpy,
    stop: stopSpy,
    supports: supportsSpy,
    run() {
      /* Исполняем итоговый текст скрипта в изолированном happy-dom-окне — как браузер при парсинге. */
      window.eval(IMPORTMAP_CHECK_SCRIPT)
    },
  }
}

afterEach(async () => {
  await Promise.all(openPages.splice(0).map((window) => window.happyDOM.close()))
})

function screenOf(page: Page) {
  return page.document.querySelector<HTMLElement>('[data-sdg-unsupported]')
}

/* Экран обязан быть: тест без него бессмысленен, а `!` в каждом месте шумит. */
function requireScreen(page: Page): HTMLElement {
  const root = screenOf(page)
  if (!root) {
    throw new Error('экран [data-sdg-unsupported] не найден')
  }
  return root
}

function requireButton(page: Page) {
  const button = requireScreen(page).querySelector('button')
  if (!button) {
    throw new Error('кнопка копирования не найдена')
  }
  return button
}

/* Цвет в том виде, как движок хранит его в style: сравниваем «как записали» без привязки к rgb()/hex. */
function normalizedColor(page: Page, color: string) {
  const probe = page.document.createElement('div')
  probe.style.backgroundColor = color
  return probe.style.backgroundColor
}

function expectNothingHappened(page: Page) {
  expect(page.details).toEqual([])
  expect(page.stop).not.toHaveBeenCalled()
  expect(screenOf(page)).toBeNull()
}

describe('inline-проверка import maps — когда молчит', () => {
  it('на странице нет import map (Nuxt < 4.1 / entryImportMap: false) → ничего', () => {
    const page = createPage({ importMap: false, supports: false })
    page.run()
    expectNothingHappened(page)
  })

  it("supports('importmap') === true → ничего", () => {
    const page = createPage({ supports: true })
    page.run()
    expect(page.supports).toHaveBeenCalledWith('importmap')
    expectNothingHappened(page)
  })
})

describe('inline-проверка import maps — браузер без поддержки', () => {
  it.each([
    ['supports вернул false (Safari 16.0–16.3, Firefox 94–107)', false],
    ['метода supports нет вовсе (Safari < 16)', 'missing'],
  ] as const)('%s → событие ДО window.stop(), stop вызван, экран в DOM', (_name, supports) => {
    const page = createPage({ supports })
    page.run()
    expect(page.details).toEqual([UNSUPPORTED_DETAIL])
    expect(page.order).toEqual(['event', 'stop'])
    expect(page.stop).toHaveBeenCalledOnce()
    expect(screenOf(page)).not.toBeNull()
  })

  it('конструктор CustomEvent бросает (старый WebKit) → событие уходит через createEvent/initCustomEvent', () => {
    const page = createPage()
    const NativeCustomEvent = page.window.CustomEvent
    /* Бросаем на `new CustomEvent(type, init)`, а `createEvent('CustomEvent')` happy-dom строит тем же
       конструктором БЕЗ init — ему разрешаем: в настоящем браузере createEvent от конструктора не зависит. */
    function ThrowingCustomEvent(type: string, init?: unknown) {
      if (init !== undefined) {
        throw new TypeError('CustomEvent is not a constructor')
      }
      return new NativeCustomEvent(type)
    }
    Object.defineProperty(page.window, 'CustomEvent', { value: ThrowingCustomEvent, configurable: true })
    page.run()
    expect(page.details).toEqual([UNSUPPORTED_DETAIL])
    expect(page.order).toEqual(['event', 'stop'])
    expect(screenOf(page)).not.toBeNull()
  })

  it('window.stop() бросает → экран всё равно показан', () => {
    const page = createPage({ stop: 'throws' })
    page.run()
    expect(page.details).toEqual([UNSUPPORTED_DETAIL])
    expect(screenOf(page)).not.toBeNull()
  })

  it('window.stop нет → событие и экран на месте', () => {
    const page = createPage({ stop: 'missing' })
    page.run()
    expect(page.details).toEqual([UNSUPPORTED_DETAIL])
    expect(screenOf(page)).not.toBeNull()
  })

  it('оверлей: fixed на весь экран поверх всего (z-index 2147483647), шрифт семейства ai.pushka.biz', () => {
    const page = createPage()
    page.run()
    const root = requireScreen(page)
    expect(root.style.position).toBe('fixed')
    expect(root.style.zIndex).toBe('2147483647')
    expect(root.style.fontFamily).toContain('Manrope')
  })
})

describe('экран — тексты', () => {
  const GENERIC_TEXT = 'Обновите браузер или откройте эту ссылку в другом браузере.'
  const IOS_UPDATE_TEXT =
    'Нужна iOS 16.4 или новее: Настройки → Основные → Обновление ПО. Другой браузер на этом устройстве не поможет.'
  const IOS_FALLBACK_TEXT = 'Если обновление недоступно, скопируйте ссылку и откройте её на компьютере.'

  it('iPhone → «Версия iOS устарела» с инструкцией по обновлению и запасным путём', () => {
    const page = createPage({ userAgent: IPHONE_UA })
    page.run()
    const root = requireScreen(page)
    expect(root.querySelector('h1')?.textContent).toBe('Версия iOS устарела')
    expect(root.textContent).toContain(IOS_UPDATE_TEXT)
    expect(root.textContent).toContain(IOS_FALLBACK_TEXT)
    expect(root.textContent).not.toContain(GENERIC_TEXT)
  })

  it('iPad с «настольным» UA (Macintosh + maxTouchPoints > 1) → тоже iOS-тексты', () => {
    const page = createPage({ userAgent: MAC_UA, maxTouchPoints: 5 })
    page.run()
    const root = requireScreen(page)
    expect(root.querySelector('h1')?.textContent).toBe('Версия iOS устарела')
    expect(root.textContent).toContain(IOS_UPDATE_TEXT)
  })

  it.each([
    ['Mac без тач-экрана', MAC_UA],
    ['Windows', WINDOWS_UA],
  ])('%s → «Браузер устарел» и общий текст, без инструкции про iOS', (_name, userAgent) => {
    const page = createPage({ userAgent })
    page.run()
    const root = requireScreen(page)
    expect(root.querySelector('h1')?.textContent).toBe('Браузер устарел')
    expect(root.textContent).toContain(GENERIC_TEXT)
    expect(root.textContent).not.toContain(IOS_UPDATE_TEXT)
    expect(root.textContent).not.toContain(IOS_FALLBACK_TEXT)
  })
})

describe('экран — адрес и копирование', () => {
  it('адрес страницы — в поле только для чтения; кнопка — настоящий <button type="button">', () => {
    const page = createPage()
    page.run()
    const root = requireScreen(page)
    const field = root.querySelector('input')
    expect(field?.readOnly).toBe(true)
    expect(field?.value).toBe(PAGE_URL)
    const button = requireButton(page)
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.textContent).toBe('Скопировать ссылку')
    expect(root.textContent).not.toContain('Ссылка скопирована')
  })

  it('клик → navigator.clipboard.writeText(location.href), затем «Ссылка скопирована» внутри экрана', async () => {
    const page = createPage({ clipboard: 'resolves' })
    page.run()
    requireButton(page).click()
    expect(page.writeText).toHaveBeenCalledExactlyOnceWith(PAGE_URL)
    await vi.waitFor(() => {
      expect(requireScreen(page).textContent).toContain('Ссылка скопирована')
    })
    expect(requireScreen(page).textContent).not.toContain('Не удалось скопировать')
  })

  it('clipboard отклонил запись → фолбэк: поле выделено, execCommand("copy") удался → «Ссылка скопирована»', async () => {
    const page = createPage({ clipboard: 'rejects', execCommand: true })
    page.run()
    requireButton(page).click()
    await vi.waitFor(() => {
      expect(requireScreen(page).textContent).toContain('Ссылка скопирована')
    })
    expect(page.execCommand).toHaveBeenCalledExactlyOnceWith('copy')
    const field = requireScreen(page).querySelector('input')
    expect(field?.selectionStart).toBe(0)
    expect(field?.selectionEnd).toBe(PAGE_URL.length)
  })

  it('clipboard API нет → сразу фолбэк через execCommand("copy")', () => {
    const page = createPage({ clipboard: 'missing', execCommand: true })
    page.run()
    requireButton(page).click()
    expect(page.execCommand).toHaveBeenCalledExactlyOnceWith('copy')
    expect(requireScreen(page).textContent).toContain('Ссылка скопирована')
  })

  it.each([
    ['clipboard API нет, execCommand тоже', { clipboard: 'missing', execCommand: 'missing' }],
    ['clipboard API нет, execCommand вернул false', { clipboard: 'missing', execCommand: false }],
  ] as const)('%s → «Не удалось скопировать — выделите адрес вручную», адрес остаётся выделенным', (_name, options) => {
    const page = createPage(options)
    page.run()
    requireButton(page).click()
    const root = requireScreen(page)
    expect(root.textContent).toContain('Не удалось скопировать — выделите адрес вручную')
    expect(root.textContent).not.toContain('Ссылка скопирована')
    expect(root.querySelector('input')?.selectionEnd).toBe(PAGE_URL.length)
  })

  it('clipboard отклонил, execCommand тоже → сообщение об ошибке', async () => {
    const page = createPage({ clipboard: 'rejects', execCommand: false })
    page.run()
    requireButton(page).click()
    await vi.waitFor(() => {
      expect(requireScreen(page).textContent).toContain('Не удалось скопировать — выделите адрес вручную')
    })
  })
})

describe('экран — палитра ai.pushka.biz', () => {
  it.each([
    ['по умолчанию — тёмная', { htmlClass: '', prefersLight: false }, DARK],
    ['html.light → светлая, даже если ОС тёмная', { htmlClass: 'light', prefersLight: false }, LIGHT],
    ['html.light среди других классов → светлая', { htmlClass: 'nuxt-ready light', prefersLight: false }, LIGHT],
    ['нет классов, prefers-color-scheme: light → светлая', { htmlClass: '', prefersLight: true }, LIGHT],
    ['html.dark перебивает prefers-color-scheme: light', { htmlClass: 'dark', prefersLight: true }, DARK],
    ['«delight» — не класс light (граница слова)', { htmlClass: 'delight', prefersLight: false }, DARK],
  ] as const)('%s', (_name, options, palette) => {
    const page = createPage(options)
    page.run()
    expect(requireScreen(page).style.backgroundColor).toBe(normalizedColor(page, palette.bg))
    expect(requireButton(page).style.backgroundColor).toBe(normalizedColor(page, palette.accent))
  })
})

describe('итоговый текст скрипта', () => {
  it('разбирается как ES5: без стрелок, шаблонных строк, let/const, ?. и ?? (иначе древний браузер молча роняет заглушку)', () => {
    expect(() => parse(IMPORTMAP_CHECK_SCRIPT, { ecmaVersion: 5 })).not.toThrow()
  })

  it('безопасен для встраивания в <script>: нет `</script` и `<!--`', () => {
    expect(IMPORTMAP_CHECK_SCRIPT).not.toMatch(/<\/script|<!--/iu)
  })
})
