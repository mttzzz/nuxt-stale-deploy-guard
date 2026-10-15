import { fileURLToPath } from 'node:url'

import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { Window } from 'happy-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IMPORTMAP_CHECK_SCRIPT } from '../../src/runtime/importmap-check'

/*
 * Fixture `ssr`: Nuxt 4.1+ кладёт entry в `<script type="importmap">` (vite.build.target: esnext снимает
 * ограничение «все цели сборки поддерживают import maps») — ровно как у ai.pushka.biz, где iPhone на iOS 16.0.2
 * падал на `Module specifier '#entry'`. Проверяем настоящую страницу прод-сборки, а не строку из исходника.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/ssr', import.meta.url)),
})

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1'

const openWindows: Window[] = []

afterEach(async () => {
  await Promise.all(openWindows.splice(0).map((window) => window.happyDOM.close()))
})

/* Открывает HTML как браузер: inline-скрипты исполняются при парсинге, внешние (entry) не грузятся. */
function openPage(html: string, browserSupportsImportMaps: boolean) {
  const window = new Window({
    url: 'https://app.example.com/invite/abc',
    settings: {
      enableJavaScriptEvaluation: true,
      suppressInsecureJavaScriptEnvironmentWarning: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
      navigator: { userAgent: IPHONE_UA },
    },
  })
  openWindows.push(window)
  const events: unknown[] = []
  window.addEventListener('app:chunk-reload-blocked', (event) => {
    events.push('detail' in event ? event.detail : undefined)
  })
  const stop = vi.fn<() => void>()
  Object.defineProperty(window, 'stop', { value: stop, configurable: true })
  Object.defineProperty(window.HTMLScriptElement, 'supports', {
    value: (type: string) => type === 'importmap' && browserSupportsImportMaps,
    configurable: true,
  })
  window.document.write(html)
  return { window, events, stop, screen: window.document.querySelector('[data-sdg-unsupported]') }
}

describe('inline-проверка import maps в странице прод-сборки — fixture: ssr', () => {
  it('скрипт отдаётся ровно один раз и дословно (Nuxt не экранирует текст)', async () => {
    const html = await $fetch<string>('/')
    expect(html.split(IMPORTMAP_CHECK_SCRIPT)).toHaveLength(2)
  })

  it('скрипт стоит в конце body, после <script type="importmap"> из head', async () => {
    const html = await $fetch<string>('/')
    const importMapAt = html.indexOf('<script type="importmap">')
    const scriptAt = html.indexOf(IMPORTMAP_CHECK_SCRIPT)
    expect(importMapAt, 'import map не найден в HTML').toBeGreaterThan(-1)
    expect(html.indexOf('<body'), 'скрипт вне body').toBeLessThan(scriptAt)
    expect(importMapAt).toBeLessThan(scriptAt)
    expect(scriptAt).toBeLessThan(html.indexOf('</body>'))
  })

  it('entry — module-скрипт без async: он deferred и стартует после парсинга, то есть после проверки', async () => {
    const html = await $fetch<string>('/')
    const moduleScripts = html.match(/<script[^>]*\btype="module"[^>]*>/gu) ?? []
    expect(moduleScripts.length).toBeGreaterThan(0)
    for (const tag of moduleScripts) {
      expect(tag).not.toMatch(/\basync\b/u)
    }
  })

  it('браузер без import maps: страница из сборки → событие, window.stop(), экран на всю страницу', async () => {
    const html = await $fetch<string>('/')
    const { events, stop, screen } = openPage(html, false)
    expect(events).toEqual([{ reason: 'unsupported-browser', missing: 'importmap' }])
    expect(stop).toHaveBeenCalledOnce()
    expect(screen?.querySelector('h1')?.textContent).toBe('Версия iOS устарела')
    expect(screen?.querySelector('button')?.textContent).toBe('Скопировать ссылку')
  })

  it('браузер с import maps: страница из сборки не затронута', async () => {
    const html = await $fetch<string>('/')
    const { events, stop, screen } = openPage(html, true)
    expect(events).toEqual([])
    expect(stop).not.toHaveBeenCalled()
    expect(screen).toBeNull()
  })
})
