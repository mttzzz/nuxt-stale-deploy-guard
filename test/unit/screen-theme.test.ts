import { type HTMLElement, Window } from 'happy-dom'
import { afterEach, describe, expect, it } from 'vitest'

import { buildDeadLoadScript } from '../../src/runtime/dead-load'
import { buildImportmapCheckScript } from '../../src/runtime/importmap-check'
import {
  DEFAULT_SCREEN_TEXTS,
  DEFAULT_SCREEN_THEME,
  resolveScreenTexts,
  resolveScreenTheme,
} from '../../src/runtime/screen-config'
import { closePages, createPage, normalizedColor, requireScreen } from './helpers/dead-load-page'

/*
 * Палитра и тексты inline-экранов модуля — опции проекта (`theme`, `texts`). Проверяем на настоящем тексте
 * скриптов: свои цвета и свои строки доходят до отрисованного экрана, а проект, который ничего не
 * переопределил, получает прежнюю картинку (палитра ai.pushka.biz и её русские тексты).
 */

/* Синяя палитра kp (brand #24a4ff, primary 500 #0086ec) — пример из README. */
const KP_THEME = {
  dark: {
    bg: '#0b1220',
    fg: '#eaf2ff',
    muted: '#9fb4d4',
    accent: '#24a4ff',
    onAccent: '#0b1220',
    line: '#24344f',
    fieldBg: '#111a2b',
  },
  light: {
    bg: '#f5f9ff',
    fg: '#0b1220',
    muted: '#4a5b76',
    accent: '#0086ec',
    onAccent: '#ffffff',
    line: '#d6e4f7',
    fieldBg: '#ffffff',
  },
}

const FAILED_URL = 'https://app.example.com/a?sdg-retry=chunk'

const openWindows: Window[] = []

afterEach(async () => {
  await Promise.all(openWindows.splice(0).map((window) => window.happyDOM.close()))
  await closePages()
})

/* Страница с import map и браузером без его поддержки — так рисуется экран «браузер устарел». */
function createUnsupportedBrowserPage() {
  const window = new Window({
    url: 'https://app.example.com/invite',
    settings: { device: { prefersColorScheme: 'dark' } },
  })
  openWindows.push(window)
  const { document } = window
  document.head.innerHTML = '<script type="importmap">{"imports":{"#entry":"/_nuxt/entry.js"}}</script>'
  document.body.innerHTML = '<div id="__nuxt"></div>'
  Object.defineProperty(window.HTMLScriptElement, 'supports', { value: () => false, configurable: true })
  return { window, document }
}

function unsupportedScreen(document: Window['document']): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-sdg-unsupported]')
  if (!root) {
    throw new Error('экран [data-sdg-unsupported] не найден')
  }
  return root
}

describe('палитра экранов', () => {
  it('по умолчанию — палитра ai.pushka.biz (тёмная)', () => {
    expect(resolveScreenTheme()).toEqual(DEFAULT_SCREEN_THEME)
    expect(DEFAULT_SCREEN_THEME.dark.accent).toBe('#c084fc')
    expect(DEFAULT_SCREEN_THEME.light.accent).toBe('#9333ea')
  })

  it('переопределение палитры доходит до экрана «страница не загрузилась»', () => {
    const page = createPage({
      url: FAILED_URL,
      script: buildDeadLoadScript({
        theme: resolveScreenTheme(KP_THEME),
        texts: DEFAULT_SCREEN_TEXTS,
        loadTimeoutMs: 0,
      }),
    })
    page.run()
    page.preloadError(new Error('boom'))

    const root = requireScreen(page)
    expect(root.style.backgroundColor).toBe(normalizedColor(page, KP_THEME.dark.bg))
    expect(root.querySelector('h1')?.style.color).toBe(normalizedColor(page, KP_THEME.dark.accent))
    expect(root.querySelector('button')?.style.backgroundColor).toBe(normalizedColor(page, KP_THEME.dark.accent))
  })

  it('светлая тема экрана берёт свои цвета (html.light)', () => {
    const page = createPage({
      url: FAILED_URL,
      htmlClass: 'light',
      script: buildDeadLoadScript({
        theme: resolveScreenTheme(KP_THEME),
        texts: DEFAULT_SCREEN_TEXTS,
        loadTimeoutMs: 0,
      }),
    })
    page.run()
    page.preloadError(new Error('boom'))

    const root = requireScreen(page)
    expect(root.style.backgroundColor).toBe(normalizedColor(page, KP_THEME.light.bg))
    expect(root.querySelector('button')?.style.backgroundColor).toBe(normalizedColor(page, KP_THEME.light.accent))
  })

  it('частичное переопределение: заданное поле своё, остальные — из дефолта', () => {
    const theme = resolveScreenTheme({ dark: { accent: '#0086ec' } })
    expect(theme.dark.accent).toBe('#0086ec')
    expect(theme.dark.bg).toBe(DEFAULT_SCREEN_THEME.dark.bg)
    expect(theme.light).toEqual(DEFAULT_SCREEN_THEME.light)
  })

  it('палитра экрана «браузер без import maps» — тоже палитра проекта', () => {
    const { window, document } = createUnsupportedBrowserPage()
    window.eval(buildImportmapCheckScript({ theme: resolveScreenTheme(KP_THEME), texts: DEFAULT_SCREEN_TEXTS }))

    const root = unsupportedScreen(document)
    expect(root.style.backgroundColor).toBe(normalizedColor(window, KP_THEME.dark.bg))
    expect(root.querySelector('button')?.style.backgroundColor).toBe(normalizedColor(window, KP_THEME.dark.accent))
  })
})

describe('тексты экранов', () => {
  it('по умолчанию — нынешние русские тексты', () => {
    expect(resolveScreenTexts()).toEqual(DEFAULT_SCREEN_TEXTS)
  })

  it('тексты экрана «страница не загрузилась» — свои', () => {
    const texts = resolveScreenTexts({
      failedTitle: 'Не открылось',
      failedAdvice: 'Проверьте интернет.',
      reload: 'Перезагрузить',
      loading: 'Загружаем…',
    })
    const page = createPage({
      url: FAILED_URL,
      script: buildDeadLoadScript({ theme: DEFAULT_SCREEN_THEME, texts, loadTimeoutMs: 0 }),
    })
    page.run()
    page.preloadError(new Error('boom'))

    const root = requireScreen(page)
    expect(root.querySelector('h1')?.textContent).toBe('Не открылось')
    expect(root.querySelector('p')?.textContent).toBe('Проверьте интернет.')
    expect(root.querySelector('button')?.textContent).toBe('Перезагрузить')
  })

  it('текст оверлея автоповтора — свой', () => {
    const page = createPage({
      script: buildDeadLoadScript({
        theme: DEFAULT_SCREEN_THEME,
        texts: resolveScreenTexts({ loading: 'Загружаем…' }),
        loadTimeoutMs: 0,
      }),
    })
    page.run()
    page.preloadError(new Error('boom'))

    expect(requireScreen(page).textContent).toBe('Загружаем…')
  })

  it('тексты экрана «браузер без import maps» — свои', () => {
    const { window, document } = createUnsupportedBrowserPage()
    window.eval(
      buildImportmapCheckScript({
        theme: DEFAULT_SCREEN_THEME,
        texts: resolveScreenTexts({
          unsupportedBrowserTitle: 'Браузер слишком старый',
          unsupportedBrowserAdvice: 'Откройте страницу в другом браузере.',
          copyLink: 'Скопировать адрес',
          urlFieldLabel: 'Адрес',
        }),
      }),
    )

    const root = unsupportedScreen(document)
    expect(root.querySelector('h1')?.textContent).toBe('Браузер слишком старый')
    expect(root.querySelector('p')?.textContent).toBe('Откройте страницу в другом браузере.')
    expect(root.querySelector('button')?.textContent).toBe('Скопировать адрес')
    expect(root.querySelector('input')?.getAttribute('aria-label')).toBe('Адрес')
  })

  it('тексты iOS-экрана «браузер без import maps» — свои (абзацы заменяются целиком)', () => {
    const { window, document } = createUnsupportedBrowserPage()
    Object.defineProperty(window.navigator, 'userAgent', {
      value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0_2 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      configurable: true,
    })
    window.eval(
      buildImportmapCheckScript({
        theme: DEFAULT_SCREEN_THEME,
        texts: resolveScreenTexts({
          unsupportedIosTitle: 'Нужен новее iOS',
          unsupportedIosAdvice: ['Обновите iOS.', 'Или откройте на компьютере.'],
        }),
      }),
    )

    const root = unsupportedScreen(document)
    expect(root.querySelector('h1')?.textContent).toBe('Нужен новее iOS')
    /* Абзацы-подсказки — все, кроме служебной заметки о копировании (она с aria-live). */
    const paragraphs = [...root.querySelectorAll('p')]
      .filter((node) => !node.hasAttribute('aria-live'))
      .map((node) => node.textContent)
    expect(paragraphs).toEqual(['Обновите iOS.', 'Или откройте на компьютере.'])
  })
})
