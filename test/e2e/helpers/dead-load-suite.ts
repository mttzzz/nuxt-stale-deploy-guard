import { describe, expect, it } from 'vitest'

import type { RetryFailedBlockedDetail } from '../../../src/runtime/chunk-reload-guard'
import { DEAD_LOAD_SCRIPT } from '../../../src/runtime/dead-load'
import { openBuiltPage, PAGE_URL } from './built-page'

/*
 * Проверки inline-скрипта «страница не загрузилась» на НАСТОЯЩЕЙ странице прод-сборки фикстуры: что он есть,
 * стоит в HTML раньше entry и реагирует на сбой entry, когда страницу разбирает «браузер». Общие для фикстур с
 * разной раскладкой тегов (SSR: import map + entry в head; SPA `ssr: false`: entry в head без import map) —
 * файл фикстуры лишь поднимает сборку, закрывает окна (`afterEach(closeBuiltPages)`) и передаёт получение HTML.
 */

const ENTRY_URL_PATTERN = /^https:\/\/app\.example\.com\/_nuxt\/[\w-]+\.js$/u

export function deadLoadSuite(fetchHtml: () => Promise<string>) {
  describe('inline-скрипт «страница не загрузилась» в странице прод-сборки', () => {
    it('отдаётся ровно один раз и дословно (Nuxt не экранирует текст)', async () => {
      const html = await fetchHtml()
      expect(html.split(DEAD_LOAD_SCRIPT)).toHaveLength(2)
    })

    it('стоит в <head> раньше КАЖДОГО <script type="module" src> (entry): слушатели готовы до его загрузки', async () => {
      const html = await fetchHtml()
      const scriptAt = html.indexOf(DEAD_LOAD_SCRIPT)
      expect(html.indexOf('<head'), 'скрипт вне head').toBeLessThan(scriptAt)
      expect(scriptAt).toBeLessThan(html.indexOf('</head>'))
      const moduleScripts = [...html.matchAll(/<script\b[^>]*\btype="module"[^>]*\bsrc=/gu)]
      expect(moduleScripts.length, 'entry не найден в HTML').toBeGreaterThan(0)
      for (const match of moduleScripts) {
        expect(scriptAt, `скрипт позже ${match[0]}`).toBeLessThan(match.index)
      }
    })

    it('entry не загрузился (первая попытка) → оверлей «Загружаем страницу…» и replace на тот же URL + sdg-retry=entry', async () => {
      const html = await fetchHtml()
      const page = openBuiltPage(html, { entryLoads: false })
      expect(page.replace).toHaveBeenCalledExactlyOnceWith(`${PAGE_URL}?sdg-retry=entry`)
      expect(page.deadLoadScreen?.dataset.sdgState).toBe('loading')
      expect(page.deadLoadScreen?.textContent).toBe('Загружаем страницу…')
      expect(page.events).toEqual([])
    })

    it('entry не загрузился и на повторе (в URL уже sdg-retry) → экран «Страница не загрузилась» и одно событие retry-failed', async () => {
      const html = await fetchHtml()
      const page = openBuiltPage(html, { entryLoads: false, url: `${PAGE_URL}?x=1&sdg-retry=entry#top` })
      expect(page.replace).not.toHaveBeenCalled()
      expect(page.deadLoadScreen?.dataset.sdgState).toBe('failed')
      expect(page.deadLoadScreen?.querySelector('h1')?.textContent).toBe('Страница не загрузилась')
      expect(page.deadLoadScreen?.querySelector('button')?.textContent).toBe('Обновить')
      expect(page.events).toHaveLength(1)
      const [detail] = page.events as RetryFailedBlockedDetail[]
      expect(detail).toMatchObject({ reason: 'retry-failed', kind: 'entry' })
      expect(detail?.url).toMatch(ENTRY_URL_PATTERN)
      expect(detail && 'error' in detail).toBe(false)
    })

    it('entry загрузился → скрипт молчит: ни экрана, ни навигации, ни событий', async () => {
      const html = await fetchHtml()
      const page = openBuiltPage(html, { entryLoads: true })
      expect(page.replace).not.toHaveBeenCalled()
      expect(page.deadLoadScreen).toBeNull()
      expect(page.events).toEqual([])
    })
  })
}
