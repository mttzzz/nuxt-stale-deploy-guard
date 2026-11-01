import { beforeEach, describe, expect, it } from 'vitest'

import plugin from '../../src/runtime/plugin.server'
import { nuxtStub } from './stubs/nuxt-app'

/*
 * Серверный плагин метки SSR: при рендере документа кладёт в head атрибут `<html data-sdg-ssr="">`, который читает
 * inline-скрипт «мёртвая первая загрузка». Что метка попадает в настоящий HTML SSR-страницы и не попадает в SPA-оболочку
 * — e2e-проверки на прод-сборках фикстур; здесь — только то, что делает сам плагин. Nuxt заменён заглушкой `#app`
 * (vitest.config.ts): `useHead` пишет вход в `nuxtStub.head`.
 */

beforeEach(() => {
  nuxtStub.head.mockClear()
})

describe('plugin.server — метка SSR-документа', () => {
  it('одним вызовом useHead кладёт на <html> атрибут data-sdg-ssr с пустым значением', () => {
    /* Заглушка defineNuxtPlugin отдаёт сам setup-колбэк: плагин вызываем как обычную функцию. */
    const setup = plugin as unknown as () => void

    setup()

    expect(nuxtStub.head).toHaveBeenCalledExactlyOnceWith({ htmlAttrs: { 'data-sdg-ssr': '' } })
  })
})
