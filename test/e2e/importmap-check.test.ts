import { fileURLToPath } from 'node:url'

import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { afterEach, describe, expect, it } from 'vitest'

import { IMPORTMAP_CHECK_SCRIPT } from '../../src/runtime/importmap-check'
import { closeBuiltPages, openBuiltPage } from './helpers/built-page'
import { deadLoadSuite } from './helpers/dead-load-suite'

/*
 * Fixture `ssr`: Nuxt 4.1+ кладёт entry в `<script type="importmap">` (vite.build.target: esnext снимает
 * ограничение «все цели сборки поддерживают import maps») — ровно как у ai.pushka.biz, где iPhone на iOS 16.0.2
 * падал на `Module specifier '#entry'`. Проверяем настоящую страницу прод-сборки, а не строку из исходника.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/ssr', import.meta.url)),
})

afterEach(closeBuiltPages)

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
    const { events, stop, unsupportedScreen } = openBuiltPage(html, { supportsImportMaps: false })
    expect(events).toEqual([{ reason: 'unsupported-browser', missing: 'importmap' }])
    expect(stop).toHaveBeenCalledOnce()
    expect(unsupportedScreen?.querySelector('h1')?.textContent).toBe('Версия iOS устарела')
    expect(unsupportedScreen?.querySelector('button')?.textContent).toBe('Скопировать ссылку')
  })

  it('браузер с import maps: страница из сборки не затронута', async () => {
    const html = await $fetch<string>('/')
    const { events, stop, unsupportedScreen } = openBuiltPage(html, { supportsImportMaps: true })
    expect(events).toEqual([])
    expect(stop).not.toHaveBeenCalled()
    expect(unsupportedScreen).toBeNull()
  })

  it('браузер без import maps: error оборванного window.stop() entry не будит скрипт «страница не загрузилась»', async () => {
    const html = await $fetch<string>('/')
    const page = openBuiltPage(html, {
      supportsImportMaps: false,
      url: 'https://app.example.com/invite/abc?sdg-retry=entry',
    })
    const entry = page.window.document.querySelector('script[type="module"][src]')
    expect(entry, 'entry не найден в странице').not.toBeNull()
    entry?.dispatchEvent(new page.window.Event('error'))
    expect(page.replace).not.toHaveBeenCalled()
    expect(page.window.document.querySelector('[data-sdg-dead-load]')).toBeNull()
    expect(page.events).toEqual([{ reason: 'unsupported-browser', missing: 'importmap' }])
  })
})

deadLoadSuite(async () => $fetch<string>('/'))
