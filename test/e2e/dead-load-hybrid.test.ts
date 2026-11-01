import { fileURLToPath } from 'node:url'

import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { afterEach, describe } from 'vitest'

import { closeBuiltPages } from './helpers/built-page'
import { deadLoadSuite, spaShellSuite, ssrDocumentSuite } from './helpers/dead-load-suite'

/*
 * Fixture `hybrid`: раскладка kp.modmb.com — одна сборка, `ssr: true` + `routeRules` (`'/**': ssr: false`,
 * `'/card/**': ssr: true`). Серверный бандл здесь есть, а плагины в нём исполняются только там, где Nuxt рендерит
 * приложение: маршрут с `routeRules.ssr: false` отдаёт SPA-оболочку (метки `data-sdg-ssr` нет — сбой entry закрывается
 * экраном и автоповтором), маршрут с `ssr: true` — настоящий SSR-документ (метка есть — содержимое не трогаем).
 * Ровно эту границу и проверяем: оба вида документа из одной сборки.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/hybrid', import.meta.url)),
})

afterEach(closeBuiltPages)

describe('маршрут с routeRules ssr: false — SPA-оболочка', () => {
  deadLoadSuite(async () => $fetch<string>('/'))
  spaShellSuite(async () => $fetch<string>('/'))
})

describe('маршрут с routeRules ssr: true — SSR-документ', () => {
  deadLoadSuite(async () => $fetch<string>('/card/abc'))
  ssrDocumentSuite(async () => $fetch<string>('/card/abc'))
})
