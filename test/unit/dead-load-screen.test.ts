import { parse } from 'acorn'
import { afterEach, describe, expect, it } from 'vitest'

import { DEAD_LOAD_SCRIPT } from '../../src/runtime/dead-load'
import { closePages, createPage, DARK, LIGHT, normalizedColor, PAGE_URL, requireScreen } from './helpers/dead-load-page'

/*
 * Оверлей скрипта «мёртвая первая загрузка» (позиция, шрифт, палитра ai.pushka.biz — те же хелперы, что у экрана
 * «браузер без import maps») и итоговый текст скрипта, который уходит в HTML: ES5, безопасный для встраивания.
 */

afterEach(closePages)

describe('оверлей', () => {
  it.each([
    ['первая попытка', PAGE_URL],
    ['повтор', 'https://app.example.com/a?sdg-retry=chunk'],
  ])('%s: fixed на весь экран поверх всего (z-index 2147483647), шрифт семейства ai.pushka.biz', (_name, url) => {
    const page = createPage({ url })
    page.run()
    page.preloadError(new Error('boom'))
    const root = requireScreen(page)
    expect(root.style.position).toBe('fixed')
    expect(root.style.zIndex).toBe('2147483647')
    expect(root.style.fontFamily).toContain('Manrope')
    expect(root.parentElement).toBe(page.document.body)
  })

  it('<body> ещё нет (сбой пришёл, пока парсится head) → оверлей в <html>, а не потерян', () => {
    const page = createPage({ noBody: true })
    page.run()
    page.preloadError(new Error('boom'))
    expect(requireScreen(page).parentElement).toBe(page.document.documentElement)
  })

  it.each([
    ['по умолчанию — тёмная', { htmlClass: '', prefersLight: false }, DARK],
    ['html.light → светлая, даже если ОС тёмная', { htmlClass: 'light', prefersLight: false }, LIGHT],
    ['нет классов, prefers-color-scheme: light → светлая', { htmlClass: '', prefersLight: true }, LIGHT],
    ['html.dark перебивает prefers-color-scheme: light', { htmlClass: 'dark', prefersLight: true }, DARK],
  ] as const)('палитра ai.pushka.biz: %s', (_name, options, palette) => {
    const page = createPage({ ...options, url: 'https://app.example.com/a?sdg-retry=chunk' })
    page.run()
    page.preloadError(new Error('boom'))
    const root = requireScreen(page)
    expect(root.style.backgroundColor).toBe(normalizedColor(page, palette.bg))
    expect(root.querySelector('button')?.style.backgroundColor).toBe(normalizedColor(page, palette.accent))
  })
})

describe('итоговый текст скрипта', () => {
  it('разбирается как ES5: без стрелок, шаблонных строк, let/const, ?. и ?? (иначе древний браузер молча роняет скрипт)', () => {
    expect(() => parse(DEAD_LOAD_SCRIPT, { ecmaVersion: 5 })).not.toThrow()
  })

  it('безопасен для встраивания в <script>: нет `</script`, `<!--`, бэктиков и `${`', () => {
    expect(DEAD_LOAD_SCRIPT).not.toMatch(/<\/script|<!--/iu)
    expect(DEAD_LOAD_SCRIPT).not.toContain('`')
    expect(DEAD_LOAD_SCRIPT).not.toContain('${')
  })

  it('без комментариев внутри: документация живёт в исходнике, в HTML уходит только код', () => {
    const comments: string[] = []
    parse(DEAD_LOAD_SCRIPT, {
      ecmaVersion: 5,
      onComment: (_block, text) => {
        comments.push(text)
      },
    })
    expect(comments).toEqual([])
  })
})
