import { type HTMLElement, Window } from 'happy-dom'
import { expect, type Mock, vi } from 'vitest'

import { buildDeadLoadScript, DEAD_LOAD_SCRIPT } from '../../../src/runtime/dead-load'
import { DEAD_LOAD_GLOBAL } from '../../../src/runtime/dead-load-bridge'
import { DEFAULT_SCREEN_TEXTS, DEFAULT_SCREEN_THEME } from '../../../src/runtime/screen-config'

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

/* `document.visibilityState` вкладки; `absent` — свойства нет вовсе (старый браузер). */
export type Visibility = 'visible' | 'hidden' | 'prerender' | 'absent'

export interface PageOptions {
  url?: string
  /* Класс на <html>: `light`/`dark` ставит @nuxtjs/color-mode. */
  htmlClass?: string
  prefersLight?: boolean
  /* `location.replace` бросает (песочница, запрет навигации). */
  replaceThrows?: boolean
  /* Скрипт исполняется до того, как парсер дошёл до <body> (сбой пришёл во время разбора head). */
  noBody?: boolean
  /* Текст скрипта (по умолчанию — дефолтный `DEAD_LOAD_SCRIPT`): для своих палитр/текстов/таймаута. */
  script?: string
  /* Видимость вкладки на старте (по умолчанию — видима). */
  visibility?: Visibility
  /* `document.readyState` (по умолчанию — как у happy-dom: `interactive`). */
  readyState?: 'loading' | 'interactive' | 'complete'
  /* `navigator.onLine` (по умолчанию — `true`). */
  online?: boolean
  /* Resource Timing: `available` — `getEntriesByType('resource')` отдаёт `resourceEntries`; `unsupported` — у
     `performance` нет `getEntriesByType`; `throws` — метод бросает. */
  resourceTiming?: 'available' | 'unsupported' | 'throws'
}

export interface Page {
  window: Window
  document: Window['document']
  /* Detail каждого события `app:chunk-reload-blocked`, по порядку. */
  details: unknown[]
  /* Detail каждого события `app:load-timeout` (watchdog «приложение не загрузилось»), по порядку. */
  timeouts: unknown[]
  replace: Mock<(url: string) => void>
  reload: Mock<() => void>
  run: () => void
  /* `app:mounted` от клиентского плагина: мост сообщает скрипту `mounted()`. */
  mounted: () => void
  /* `vite:preloadError` как его шлёт Vite: Event с `payload`. Возвращает событие (для defaultPrevented). */
  preloadError: (payload?: unknown) => Event
  /* `<script ...>` в DOM; сбой загрузки — `failScript`. */
  addScript: (attrs: Record<string, string>) => HTMLElement
  /* Сбой загрузки элемента (`<script>`, `<link>`, `<img>`): событие `error` без ошибки, цель — сам элемент. */
  failScript: (element: HTMLElement) => void
  /* Вкладка стала видимой/скрытой: меняет `document.visibilityState` и шлёт `visibilitychange`
     (`silent` — состояние меняется, события нет). */
  setVisibility: (state: Visibility, options?: { silent?: boolean }) => void
  setReadyState: (state: 'loading' | 'interactive' | 'complete') => void
  setOnline: (online: boolean) => void
  /* Абсолютные URL, по которым в Resource Timing уже есть запись (ресурс дозагружен); массив живой. */
  resourceEntries: string[]
  /* Сколько интервалов, заведённых скриптом через `window.setInterval`, ещё живо. */
  liveIntervals: () => number
  /* Runtime-ошибка на window — `ErrorEvent` (цель — сам window). */
  runtimeError: (init: { message: string; filename?: string; lineno?: number; colno?: number }) => void
  /* `unhandledrejection` с причиной `reason`. */
  rejection: (reason: unknown) => void
}

const openPages: Window[] = []
/* Что снять со страницы перед закрытием: живые интервалы watchdog'а (при реальных таймерах они настоящие). */
const cleanups: (() => void)[] = []

export async function closePages(): Promise<void> {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
  await Promise.all(openPages.splice(0).map((window) => window.happyDOM.close()))
}

/* Скрипт с заданным порогом watchdog'а (палитра и тексты — дефолтные): `loadTimeoutMs` запекается в текст скрипта. */
export function scriptWithTimeout(loadTimeoutMs: number) {
  return buildDeadLoadScript({ theme: DEFAULT_SCREEN_THEME, texts: DEFAULT_SCREEN_TEXTS, loadTimeoutMs })
}

export function createPage(options: PageOptions = {}): Page {
  const {
    url = PAGE_URL,
    htmlClass = '',
    prefersLight = false,
    replaceThrows = false,
    noBody = false,
    script: scriptText = DEAD_LOAD_SCRIPT,
    resourceTiming = 'available',
  } = options
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

  /* Интервалы страницы — глобальные: у happy-dom свои, и под vitest'овскими fake timers они не срабатывают.
     Обращаемся к globalThis в момент вызова, поэтому fake timers работают и после создания окна. Живые
     интервалы держим в наборе: по нему тест видит, остановлен ли watchdog, а `closePages` гасит остаток. */
  const intervals = new Set<ReturnType<typeof setInterval>>()
  Object.defineProperty(window, 'setInterval', {
    value: (callback: () => void, delay?: number) => {
      const handle = globalThis.setInterval(callback, delay)
      intervals.add(handle)
      return handle
    },
    configurable: true,
  })
  Object.defineProperty(window, 'clearInterval', {
    value: (handle?: ReturnType<typeof setInterval>) => {
      if (handle !== undefined) {
        intervals.delete(handle)
      }
      globalThis.clearInterval(handle)
    },
    configurable: true,
  })
  cleanups.push(() => {
    for (const handle of intervals) {
      globalThis.clearInterval(handle)
    }
    intervals.clear()
  })
  /* Дата страницы — тоже глобальная: иначе под fake timers окно считает по реальным часам, и `elapsedMs`/`visibleMs`
     в отчёте watchdog'а не совпадают с ходом тестовых часов. */
  Object.defineProperty(window, 'Date', { value: globalThis.Date, configurable: true })

  let visibility: Visibility = options.visibility ?? 'visible'
  Object.defineProperty(document, 'visibilityState', {
    get: () => (visibility === 'absent' ? undefined : visibility),
    configurable: true,
  })
  let readyState: string = options.readyState ?? document.readyState
  Object.defineProperty(document, 'readyState', { get: () => readyState, configurable: true })
  let online = options.online ?? true
  Object.defineProperty(window.navigator, 'onLine', { get: () => online, configurable: true })

  const resourceEntries: string[] = []
  const performanceStub = { now: () => globalThis.performance.now() }
  Object.defineProperty(window, 'performance', {
    value:
      resourceTiming === 'unsupported'
        ? performanceStub
        : {
            ...performanceStub,
            getEntriesByType(type: string) {
              if (resourceTiming === 'throws') {
                throw new Error('SecurityError')
              }
              return type === 'resource' ? resourceEntries.map((name) => ({ name, entryType: 'resource' })) : []
            },
          },
    configurable: true,
  })

  const details: unknown[] = []
  window.addEventListener('app:chunk-reload-blocked', (event) => {
    details.push('detail' in event ? event.detail : undefined)
  })

  const timeouts: unknown[] = []
  window.addEventListener('app:load-timeout', (event) => {
    timeouts.push('detail' in event ? event.detail : undefined)
  })

  return {
    window,
    document,
    details,
    timeouts,
    replace,
    reload,
    resourceEntries,
    run() {
      window.eval(scriptText)
    },
    mounted() {
      const bridge = Reflect.get(window, DEAD_LOAD_GLOBAL) as { mounted?: () => void } | undefined
      bridge?.mounted?.()
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
    failScript(element) {
      element.dispatchEvent(new window.Event('error'))
    },
    setVisibility(state, { silent = false } = {}) {
      visibility = state
      if (!silent) {
        document.dispatchEvent(new window.Event('visibilitychange'))
      }
    },
    setReadyState(state) {
      readyState = state
    },
    setOnline(next) {
      online = next
    },
    liveIntervals: () => intervals.size,
    runtimeError({ message, filename = '', lineno = 0, colno = 0 }) {
      window.dispatchEvent(
        new window.ErrorEvent('error', { message, filename, lineno, colno, error: new Error(message) }),
      )
    },
    rejection(reason) {
      const event = new window.Event('unhandledrejection', { cancelable: true })
      Object.assign(event, { reason })
      window.dispatchEvent(event)
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
export function normalizedColor(page: { document: Window['document'] }, color: string) {
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
