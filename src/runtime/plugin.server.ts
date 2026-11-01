import { defineNuxtPlugin, useHead } from '#app'

import { SSR_MARKER_ATTR } from './dead-load-bridge'

/*
 * Серверный Nuxt-плагин (`mode: 'server'`; `module.ts` подключает его в проде, там же, где inline-скрипты):
 * помечает документ, ОТРЕНДЕРЕННЫЙ на сервере, атрибутом `<html data-sdg-ssr="">`. Метку читает inline-скрипт
 * «мёртвая первая загрузка» (`dead-load.ts`): в таком документе содержимое уже в HTML и читается без JS, обычные
 * ссылки работают, поэтому оверлей поверх него и перезагрузка страницы только ухудшили бы работающую страницу.
 * Что именно скрипт делает на помеченном документе — `dead-load.ts`, пункт 8.
 *
 * Почему метку ставит плагин. «Настоящий SSR» от «SPA-оболочки» отличает только то, создавалось ли Nuxt-приложение
 * на сервере, а плагины исполняются ровно тогда, когда оно создаётся. Проверено по исходникам Nuxt
 * (`@nuxt/nitro-server/dist/runtime/utils/renderer/build-files.mjs`, 4.4.2 и 4.5.2):
 *   - `getRenderer(ssrContext)` возвращает `getSPARenderer()`, если `NUXT_NO_SSR || ssrContext.noSSR`, иначе
 *     `getSSRRenderer()`. `NUXT_NO_SSR` — глобальный `ssr: false`; `ssrContext.noSSR` выставляет
 *     `handlers/renderer.mjs` для `routeRules.ssr === false`, а `middleware/no-ssr.mjs` — для запроса с
 *     заголовком `x-nuxt-no-ssr`;
 *   - SPA-рендерер собирает оболочку через `createRenderer(() => () => {}, { renderToString: () => spaTemplate })`
 *     и серверный entry (`createSSRApp`) не вызывает: приложение не создаётся, плагины не исполняются, `useHead`
 *     ниже не вызывается — метки в оболочке нет;
 *   - серверный entry вызывает только `getSSRRenderer()`: приложение создаётся, плагины исполняются, метка
 *     попадает в `<html>`;
 *   - при глобальном `ssr: false` приложения нет и в самой сборке: `@nuxt/vite-builder` берёт серверным entry
 *     `nuxt/dist/app/entry-spa.js` (`export default () => {}`), а не настоящий — серверные плагины не исполняются
 *     ни для одного маршрута (`serverEntry = nuxt.options.ssr ? entry : entry-spa`).
 * Записи `app.head` (в том числе inline-скрипты модуля) обработчик кладёт в `ssrContext.head` до выбора
 * рендерера, поэтому скрипт есть в обоих видах документа, а метка — только в настоящем SSR. Клиентский unhead
 * метку не трогает: он убирает только атрибуты, которые поставил сам (`unhead/dist/client.mjs`, `sideEffects`),
 * так что после гидрации метка остаётся в DOM. В dev плагин не подключается вместе с inline-скриптами: ему там
 * некому служить.
 */
export default defineNuxtPlugin(() => {
  useHead({ htmlAttrs: { [SSR_MARKER_ATTR]: '' } })
})
