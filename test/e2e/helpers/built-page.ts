import { type HTMLElement, Window } from 'happy-dom'
import { vi } from 'vitest'

/*
 * Открывает HTML страницы прод-сборки фикстуры так, как это делает браузер: inline-скрипты исполняются при
 * парсинге, внешние (entry) не грузятся — вместо этого happy-dom сам рапортует итог загрузки каждого
 * `<script type="module" src>`: `load`, если `entryLoads`, иначе `error` (как при обрыве сети или 404 CDN).
 * Навигацию (`location.replace`/`reload`) и `window.stop()` подменяем шпионами: настоящие увели бы окно по сети.
 */

export const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

export const PAGE_URL = 'https://app.example.com/invite/abc'

export interface BuiltPageOptions {
  url?: string
  /* Файлы entry загрузились. false — на каждый `<script type="module" src>` придёт `error`. */
  entryLoads?: boolean
  /* Ответ `HTMLScriptElement.supports('importmap')`. */
  supportsImportMaps?: boolean
  userAgent?: string
}

const openWindows: Window[] = []

export async function closeBuiltPages(): Promise<void> {
  await Promise.all(openWindows.splice(0).map((window) => window.happyDOM.close()))
}

export function openBuiltPage(html: string, options: BuiltPageOptions = {}) {
  const { url = PAGE_URL, entryLoads = true, supportsImportMaps = true, userAgent = IPHONE_UA } = options
  const window = new Window({
    url,
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      handleDisabledFileLoadingAsSuccess: entryLoads,
      navigator: { userAgent },
    },
  })
  openWindows.push(window)
  /* Detail каждого события `app:chunk-reload-blocked`, по порядку. */
  const events: unknown[] = []
  window.addEventListener('app:chunk-reload-blocked', (event) => {
    events.push('detail' in event ? event.detail : undefined)
  })
  const stop = vi.fn<() => void>()
  const replace = vi.fn<(target: string) => void>()
  const reload = vi.fn<() => void>()
  Object.defineProperty(window, 'stop', { value: stop, configurable: true })
  Object.defineProperty(window.location, 'replace', { value: replace, configurable: true })
  Object.defineProperty(window.location, 'reload', { value: reload, configurable: true })
  Object.defineProperty(window.HTMLScriptElement, 'supports', {
    value: (type: string) => type === 'importmap' && supportsImportMaps,
    configurable: true,
  })
  window.document.write(html)
  return {
    window,
    events,
    stop,
    replace,
    reload,
    /* Экран «браузер без import maps» (importmap-check.ts). */
    unsupportedScreen: window.document.querySelector<HTMLElement>('[data-sdg-unsupported]'),
    /* Экран «загружаем страницу» / «страница не загрузилась» (dead-load.ts). */
    deadLoadScreen: window.document.querySelector<HTMLElement>('[data-sdg-dead-load]'),
  }
}
