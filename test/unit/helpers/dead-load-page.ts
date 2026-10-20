import { type HTMLElement, Window } from 'happy-dom'
import { expect, type Mock, vi } from 'vitest'

import { DEAD_LOAD_SCRIPT } from '../../../src/runtime/dead-load'

/*
 * Страница для unit-тестов inline-скрипта «мёртвая первая загрузка» (dead-load.ts): изолированное happy-dom-окно,
 * в котором исполняется ИТОГОВАЯ строка скрипта — ровно тот текст, который модуль кладёт в `app.head.script` (head).
 * Навигацию (`location.replace`/`reload`) подменяем шпионами: настоящая увела бы окно по сети. Экран ищем по
 * маркерам из контракта: корень несёт `data-sdg-dead-load` и `data-sdg-state`.
 */

export const PAGE_URL = 'https://app.example.com/invite/abc?x=1#top'
export const ENTRY_URL = 'https://cdn.example.com/_nuxt/entry.abc123.js'

export const DARK = { bg: '#1d161e', accent: '#c084fc' }
export const LIGHT = { bg: '#ffffff', accent: '#9333ea' }

export interface PageOptions {
  url?: string
  /* Класс на <html>: `light`/`dark` ставит @nuxtjs/color-mode. */
  htmlClass?: string
  prefersLight?: boolean
  /* `location.replace` бросает (песочница, запрет навигации). */
  replaceThrows?: boolean
  /* Скрипт исполняется до того, как парсер дошёл до <body> (сбой пришёл во время разбора head). */
  noBody?: boolean
}

export interface Page {
  window: Window
  document: Window['document']
  /* Detail каждого события `app:chunk-reload-blocked`, по порядку. */
  details: unknown[]
  replace: Mock<(url: string) => void>
  reload: Mock<() => void>
  run: () => void
  /* `vite:preloadError` как его шлёт Vite: Event с `payload`. Возвращает событие (для defaultPrevented). */
  preloadError: (payload?: unknown) => Event
  /* `<script ...>` в DOM; сбой загрузки — `failScript`. */
  addScript: (attrs: Record<string, string>) => HTMLElement
  failScript: (script: HTMLElement) => void
}

const openPages: Window[] = []

export async function closePages(): Promise<void> {
  await Promise.all(openPages.splice(0).map((window) => window.happyDOM.close()))
}

export function createPage(options: PageOptions = {}): Page {
  const { url = PAGE_URL, htmlClass = '', prefersLight = false, replaceThrows = false, noBody = false } = options
  const window = new Window({
    url,
    settings: {
      device: { prefersColorScheme: prefersLight ? 'light' : 'dark' },
      /* Файлы скриптов не грузятся и «успешно» — сбой пишет сам тест через `failScript`, а не happy-dom. */
      disableJavaScriptFileLoading: true,
      handleDisabledFileLoadingAsSuccess: true,
    },
  })
  openPages.push(window)
  const { document } = window
  document.documentElement.className = htmlClass
  document.body.innerHTML = '<div id="__nuxt"></div>'
  if (noBody) {
    document.body.remove()
  }

  const replace = vi.fn<(target: string) => void>(() => {
    if (replaceThrows) {
      throw new Error('SecurityError')
    }
  })
  const reload = vi.fn<() => void>()
  Object.defineProperty(window.location, 'replace', { value: replace, configurable: true })
  Object.defineProperty(window.location, 'reload', { value: reload, configurable: true })

  const details: unknown[] = []
  window.addEventListener('app:chunk-reload-blocked', (event) => {
    details.push('detail' in event ? event.detail : undefined)
  })

  return {
    window,
    document,
    details,
    replace,
    reload,
    run() {
      window.eval(DEAD_LOAD_SCRIPT)
    },
    preloadError(payload) {
      const event = new window.Event('vite:preloadError', { cancelable: true })
      Object.assign(event, { payload })
      window.dispatchEvent(event)
      return event as unknown as Event
    },
    addScript(attrs) {
      const script = document.createElement('script')
      for (const [name, value] of Object.entries(attrs)) {
        script.setAttribute(name, value)
      }
      document.head.append(script)
      return script
    },
    failScript(script) {
      script.dispatchEvent(new window.Event('error'))
    },
  }
}

export function screenOf(page: Page) {
  return page.document.querySelector<HTMLElement>('[data-sdg-dead-load]')
}

/* Экран обязан быть: тест без него бессмысленен, а `!` в каждом месте шумит. */
export function requireScreen(page: Page): HTMLElement {
  const root = screenOf(page)
  if (!root) {
    throw new Error('экран [data-sdg-dead-load] не найден')
  }
  return root
}

/* Цвет в том виде, как движок хранит его в style: сравниваем «как записали» без привязки к rgb()/hex. */
export function normalizedColor(page: Page, color: string) {
  const probe = page.document.createElement('div')
  probe.style.backgroundColor = color
  return probe.style.backgroundColor
}

export function expectNothingHappened(page: Page) {
  expect(page.replace).not.toHaveBeenCalled()
  expect(page.reload).not.toHaveBeenCalled()
  expect(page.details).toEqual([])
  expect(screenOf(page)).toBeNull()
}
