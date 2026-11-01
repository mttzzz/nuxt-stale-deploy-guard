# @mttzzz/nuxt-stale-deploy-guard

Nuxt 4 module: Cache-Control headers + verify-before-reload chunk guard for SPA deploys.

Решает проблему: SPA (`ssr: false`) после деплоя iOS Safari эвристически кеширует
HTML, который ссылается на удалённые `/_nuxt/<hash>.js` чанки → 404 → белый экран.

## Установка

```bash
bun add github:mttzzz/nuxt-stale-deploy-guard#v0.1.0
```

## Использование

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@mttzzz/nuxt-stale-deploy-guard'],
})
```

С опциями:

```ts
export default defineNuxtConfig({
  modules: ['@mttzzz/nuxt-stale-deploy-guard'],
  staleDeployGuard: {
    buildIdHeader: 'x-app-build-id',
    pollIntervalMs: 60_000,
    apiPaths: ['/api/**'],
  },
})
```

## Sentry filter (sub-export)

```ts
// app/plugins/sentry.client.ts
import { createSentryStaleChunkFilter, STALE_CHUNK_PATTERNS } from '@mttzzz/nuxt-stale-deploy-guard/sentry'

Sentry.init({
  ignoreErrors: [...STALE_CHUNK_PATTERNS],
  beforeSend: createSentryStaleChunkFilter(),
})
```

Sub-export не тянет за собой `@sentry/*` — типы структурные, фильтр работает с любым
event-shape, имеющим `breadcrumbs`.

## Что делает

- Ставит `Cache-Control` headers через `routeRules`:
  - `/**` → `no-cache, must-revalidate`
  - `/_nuxt/**` → `public, max-age=31536000, immutable`
  - `/api/**` → `no-store`
  - `/service-worker.js` → `no-cache, no-store, must-revalidate`
- Эмитит `x-app-build-id` header на каждый response (Nitro plugin).
- Сбой чанка/entry ДО `app:mounted` (первая загрузка страницы) ведёт inline-скрипт из head, без HEAD-проб:
  один автоповтор страницы с маркером `sdg-retry` в URL, а если и он не помог — экран «Страница не загрузилась»
  с кнопкой и событие `retry-failed` (см. «Мёртвая первая загрузка» ниже).
- После монтирования ловит `vite:preloadError`, `app:chunkError`, `vue:error`, `unhandledrejection`, `error` →
  серия HEAD-проб на текущий путь (4 через 400 мс, cache-buster `sdg-probe`) → если ХОТЬ ОДНА
  увидела чужой build-id → reload через `reloadNuxtApp`. Reload только по доказательству, что
  вкладка сломана: работающую вкладку модуль сам не перезагружает.
- Ошибку загрузки чанка guard глотает (`preventDefault`), поэтому каждый исход «перезагрузки не будет» —
  build-id совпал на всех пробах, cooldown, circuit breaker, нет build-id — он сообщает событием
  `app:chunk-reload-blocked` с исходной ошибкой (см. ниже). Иначе вкладка остаётся мёртвой, а в Sentry тишина.
- Cooldown 10s + circuit breaker (3 попытки в 5 мин): при срабатывании reload не случается, а событие
  `app:chunk-reload-blocked` называет причину.
- Опциональный проактивный poll (`pollIntervalMs > 0`): та же серия проб, но reload только когда
  ВСЕ пробы единогласно увидели один чужой build-id — флот сошёлся на новом билде. Вердикт «хоть
  одна проба» здесь ложный: в окне rolling-деплоя вкладка на новом билде видела бы старый под и
  уезжала на старый билд. О новой версии консьюмеру лучше сообщать самому
  (Nuxt `app:manifest:update` → тост), а старую вкладку с immutable-ассетами на CDN не трогать.
  Poll работает с рабочей вкладкой и ошибки не глотает, поэтому событий `app:chunk-reload-blocked` не шлёт
  ни при каком исходе, включая circuit breaker (до 0.5.0 circuit breaker poll'а событие слал).
- Добавляет в страницу inline-проверку import maps: браузер без них (iOS < 16.4) получает экран-заглушку
  вместо `500 Module specifier '#entry'` (см. ниже).
- Рисует оба экрана в палитре и с текстами проекта (`theme`, `texts`): по умолчанию — палитра ai.pushka.biz и её
  русские тексты, у каждого проекта свои (см. «Палитра и тексты экранов»).
- Следит за первой загрузкой: если приложение так и не смонтировалось за `loadTimeoutMs` (дефолт 45 с) ВИДИМОГО
  времени и экран «страница не загрузилась» не показан — событие `app:load-timeout` с диагностикой: на какой стадии
  застряла загрузка (`network` / `boot`), какие ресурсы не пришли и какие ошибки были (см. «Watchdog»).
- Не прячет документ, отрендеренный Nuxt на сервере (`<html data-sdg-ssr="">` — метку ставит серверный плагин
  модуля): там содержимое уже в HTML и читается без JS, поэтому при сбое JS скрипт не рисует оверлей, не
  перезагружает страницу и не шлёт `retry-failed`, а watchdog шлёт отчёт, только если завис стиль. SPA-оболочка
  ведёт себя как раньше (см. «SSR-документы»).

## Событие `app:chunk-reload-blocked`

`window.dispatchEvent(new CustomEvent('app:chunk-reload-blocked', { detail }))`. Смысл: guard проглотил
(или не стал обрабатывать) сбой загрузки чанка/скрипта, и перезагрузки не будет. Подписчик — код приложения
(отчёт в Sentry, error-boundary и т.п.); модуль событие сам не потребляет.

```ts
globalThis.addEventListener('app:chunk-reload-blocked', (event) => {
  const { detail } = event as CustomEvent<{ reason: string; error?: unknown }>
  // detail.reason — причина из таблицы ниже, остальные поля — по ней
})
```

`detail` — объединение по `reason`:

| `reason`              | Когда                                                                                                       | Поля                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `not-stale`           | реактивная верификация: ни одна проба не увидела чужой build-id — чанк сломан не деплоем                    | `error`, `probes: string[]`, `buildId: string`                       |
| `circuit-breaker`     | реактивная верификация хотела reload, circuit breaker запретил                                              | `error`, `probes`, `buildId`, `attempts: number`, `windowMs: number` |
| `cooldown`            | реактивная верификация пропущена: идёт cooldown после reload, а чанк упал уже на новой странице             | `error`, `buildId`                                                   |
| `no-build-id`         | реактивная верификация пропущена: у клиента нет build-id                                                    | `error`                                                              |
| `unsupported-browser` | inline-скрипт: браузер без import maps, приложение не стартует (см. ниже)                                   | `missing: 'importmap'`                                               |
| `retry-failed`        | inline-скрипт: страница не загрузилась до `app:mounted` и после автоповтора (см. «Мёртвая первая загрузка») | `kind: 'chunk' \| 'entry'`, `error?`, `url?`                         |

`error` — исходная ошибка/значение, запустившее верификацию: payload `vite:preloadError`, `reason`
`unhandledrejection`, `error ?? message` события `error`, ошибка `vue:error`/`app:error`, `error` из хука
`app:chunkError` (`{ error }`). Ключ есть всегда, значение может быть `undefined`. `probes` — build-id каждой
пробы (пустая строка — проба упала или ответила без заголовка).

У `retry-failed`: `kind` — что не загрузилось (`'chunk'` — чанк страницы, динамический импорт; `'entry'` —
`<script type="module" src>` точки входа); `error` — payload `vite:preloadError` или ошибка из хука/слушателя
плагина, если она есть (у `entry` её нет: событие `error` скрипта ошибки не несёт, ключа в detail нет);
`url` — адрес не загрузившегося скрипта entry. Событие приходит ровно один раз за загрузку страницы.

Событие НЕ шлётся:

- при reload — вкладку лечит сам reload;
- когда вызов упёрся в идущую верификацию (`verifyInFlight`): свой исход отправит она;
- в cooldown страницы, которая сама вызвала reload: вкладка доживает до выгрузки, и хвостовые ошибки чанков —
  ещё старая страница (иначе каждая устаревшая вкладка слала бы событие на каждом деплое);
- poll-вердиктом (`pollIntervalMs > 0`) — ни при каком исходе, включая его circuit breaker;
- для первого сбоя загрузки страницы (автоповтор с `sdg-retry`): `retry-failed` приходит, только когда повтор не помог;
- на SSR-документе (метка `data-sdg-ssr` на `<html>`): сбой до `app:mounted` скрипт поглощает молча — ни `retry-failed`,
  ни экрана (см. «SSR-документы»).

События `unsupported-browser` и `retry-failed` приходят до старта приложения (Nuxt-плагины не запускаются вовсе
или ещё не зарегистрированы, Sentry SDK может быть не инициализирован), поэтому слушать их должен ранний
inline-скрипт в `<head>` (`tagPosition: 'head'`), а не клиентский плагин.

## Экран для браузеров без import maps

Nuxt 4.1+ кладёт entry в `<script type="importmap">` под ключом `#entry`, страницы-чанки импортируют
`"#entry"`. Браузер без import maps (Safari и iOS < 16.4, Firefox < 108) разрешить его не может: страница
падает на `500 Module specifier '#entry' does not start with "/", "./", or "../"`, guard эту ошибку молча
глотает, а `ignoreErrors` в Sentry режет её. Прод-инцидент ai.pushka.biz 15.10.2026: iPhone на iOS 16.0.2.

Модуль добавляет в `app.head.script` inline-скрипт (`tagPosition: 'bodyClose'`, ключ
`stale-deploy-guard-importmap-check`, исходник — `src/runtime/importmap-check.ts`). Только в проде
(`!nuxt.options.dev`), без опций. На bodyClose `<script type="importmap">` из head уже в DOM, а скрипт
исполняется во время парсинга — раньше deferred module-скриптов entry.

Что делает скрипт:

1. На странице нет `script[type="importmap"]` (Nuxt < 4.1, `experimental.entryImportMap: false`, сборка с
   целями без поддержки import maps) — выходит, страница не затронута.
2. `HTMLScriptElement.supports('importmap') === true` — выходит. Метода нет или он вернул не `true` — браузер
   без import maps.
3. Вызывает `window.stop()`: парсер прерывается, module-скрипты entry не исполняются, **приложение не
   стартует** (ни hydration, ни Sentry SDK). Перед остановкой скрипт помечает общее состояние
   (`window.__sdgDeadLoad.takenOver`): `error` оборванных остановкой скриптов entry не будят скрипт «страница
   не загрузилась» (см. ниже).
4. Шлёт `app:chunk-reload-blocked` с `{ reason: 'unsupported-browser', missing: 'importmap' }` — именно после
   остановки: запрос-отчёт, начатый слушателем уже после `window.stop()`, ею не обрывается ни в каком движке.
5. Рисует экран на всю страницу (fixed, `z-index: 2147483647`):
   - iPhone/iPad (`iPhone|iPad|iPod` в UA либо `Macintosh` + `maxTouchPoints > 1`): «Версия iOS устарела»,
     «Нужна iOS 16.4 или новее: Настройки → Основные → Обновление ПО. Другой браузер на этом устройстве не
     поможет.» и «Если обновление недоступно, скопируйте ссылку и откройте её на компьютере.»;
   - остальные: «Браузер устарел», «Обновите браузер или откройте эту ссылку в другом браузере.»;
   - адрес страницы в поле только для чтения и кнопка «Скопировать ссылку» (`navigator.clipboard.writeText`,
     фолбэк — выделить поле и `document.execCommand('copy')`); после успеха «Ссылка скопирована», при отказе —
     «Не удалось скопировать — выделите адрес вручную».

Оформление — палитра проекта: по умолчанию палитра ai.pushka.biz (тёмная — фон `#1d161e`, акцент `#c084fc`;
светлая при `html.light` (класс `@nuxtjs/color-mode`) или, если на `<html>` нет `.dark`, при
`prefers-color-scheme: light` — фон `#ffffff`, акцент `#9333ea`). Свои цвета и свои строки — опции `theme` и
`texts` (см. «Палитра и тексты экранов»). Маркеры для интеграционных проверок: корневой элемент оверлея несёт
атрибут `data-sdg-unsupported`, кнопка — настоящий `<button type="button">`.

Скрипт написан на синтаксисе ES5 (разбирается любым древним браузером), DOM строится через
`createElement`/`textContent`. Это inline-скрипт — как и inline-payload самого Nuxt: при строгом CSP ему нужен
nonce/hash. Известное ограничение: Chrome/Edge 89–95 поддерживают import maps, но не имеют
`HTMLScriptElement.supports` (появился в 96) — их «метода нет» тоже приводит к экрану.

## Мёртвая первая загрузка: автоповтор и экран «Страница не загрузилась»

Проблема (Sentry KP-MODMB-COM-1H). Nuxt-плагин `nuxt:router` (`enforce: 'pre'`) запускает первую навигацию внутри
собственного setup, поэтому динамический импорт чанка страницы падает РАНЬШЕ, чем зарегистрированы плагин guard и
плагин Sentry. Ретрай в `app:created` может пройти, но Nuxt уже показал «500 — Failed to fetch dynamically imported
module» и не убирает страницу ошибки (`clearError` в `afterEach` пропускается, пока `isHydrating`). Итог: одна
транзитная ошибка сети = мёртвая вкладка без кнопки, без HEAD-проб и без события в Sentry; до guard доходит только
двойной сбой, и тогда пробы видят «билд актуален» и не перезагружают.

Модуль добавляет в `app.head.script` ещё один inline-скрипт (`tagPosition: 'head'`, числовой `tagPriority: -1`,
ключ `stale-deploy-guard-dead-load`, исходник — `src/runtime/dead-load.ts`). Только в проде (`!nuxt.options.dev`),
без опций. Он стоит в HTML раньше entry `<script type="module">` (сразу после import map Nuxt, если она есть):
слушатели готовы до того, как entry начнёт грузиться.

Область — только сбои ДО `app:mounted`. После монтирования всё работает как раньше: HEAD-пробы,
verify-before-reload, события `not-stale` / `circuit-breaker` / `cooldown` / `no-build-id`.

Триггеры (первый сбой за загрузку страницы побеждает, остальные игнорируются):

| Источник                                                                                                                                             | `kind`  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| событие window `vite:preloadError`                                                                                                                   | `chunk` |
| сбой в хуках и слушателях клиентского плагина: `app:chunkError`, `app:error`, `vue:error`, `unhandledrejection`, `error` (тот же фильтр stale-chunk) | `chunk` |
| `error`, пойманный на window в фазе capture, цель которого — `<script type="module" src>`                                                            | `entry` |

Ошибки `<link>` (modulepreload, stylesheet) игнорируются. HEAD-проб нет: скрипт реагирует сразу.

Защита от петли — маркер `sdg-retry` в query URL (значение `chunk` или `entry` — что не загрузилось):

1. Сбой на URL БЕЗ маркера → оверлей «Загружаем страницу…» (`data-sdg-state="loading"`) и `location.replace` на тот
   же URL + `sdg-retry=<kind>`: путь, прочие query и hash сохраняются. Смена URL заодно обходит HTTP-кеш
   устаревшего HTML.
2. Сбой на URL, где маркер уже есть (любое значение) → экран «Страница не загрузилась» (`data-sdg-state="failed"`):
   заголовок `<h1>`, подсказка «Проверьте подключение к интернету и нажмите «Обновить».» и настоящая кнопка
   `<button type="button">` «Обновить» — `location.reload()`, маркер остаётся: одно нажатие = одна попытка.
3. После успешного `app:mounted` клиентский плагин сообщает скрипту `mounted()` и убирает из адреса только ключ
   `sdg-retry` через `router.replace` (прочие query и hash на месте).

Оформление — как у экрана для браузеров без import maps (общие хелперы — `src/runtime/inline-screen.ts`): fixed
на весь экран (`z-index: 2147483647`), палитра и тексты проекта (опции `theme`/`texts`, по умолчанию — палитра
ai.pushka.biz и её русские тексты), ES5, DOM через `createElement`/`textContent`.
Маркеры для интеграционных проверок: корневой элемент несёт атрибут `data-sdg-dead-load` и
`data-sdg-state="loading" | "failed"`. Если сработал экран «браузер без import maps»
(`window.stop()`), скрипт не делает ничего: ни повтора, ни второго экрана, ни события.

Что сообщается. На экране «Страница не загрузилась» на window ровно один раз за загрузку страницы уходит
`app:chunk-reload-blocked` с `{ reason: 'retry-failed', kind, error?, url? }` (контракт — таблица выше). Первый,
автоповторяемый сбой события не даёт. В Sentry это событие отправляет ТОЛЬКО ранний inline-beacon
`@mttzzz/nuxt-sentry`: guard ≥ 0.6.0 нужно ставить вместе с nuxt-sentry ≥ 0.11.0 — более старый nuxt-sentry
молча отбрасывает неизвестные `reason`, и сбой остаётся без отчёта.

Успешные повторы считаются по логам шлюза. Каждая попытка — запрос страницы с `sdg-retry=` в пути (в том числе
повторы кнопкой «Обновить»: маркер остаётся в URL), поэтому число попыток и их `kind` видно прямо в логах;
неуспешные приходят в Sentry событием `retry-failed`. Например, VictoriaLogs (LogsQL):

```logsql
kubernetes.container_name:=envoy "x-envoy-origin-path":~"sdg-retry=" | extract_regexp "sdg-retry=(?P<kind>[a-z]+)" from "x-envoy-origin-path" | stats by (":authority", kind) count() hits
```

Мост плагина — глобал `window.__sdgDeadLoad`: `fail(kind, error?, url?)` — сообщить о pre-mount сбое (идемпотентно),
`mounted()` — приложение смонтировано, дальше скрипт ни на что не реагирует, `handled()` — документ уже пережил
сбой (сделан автоповтор или показан экран «Страница не загрузилась»); у inline-скрипта 0.6.0 такого метода нет, и
такой документ считается не пережившим сбой — поведение прежнее. Типы и чтение моста —
`src/runtime/dead-load-bridge.ts`. Моста нет (dev, старый кешированный HTML) — плагин работает как раньше.

После автоповтора или экрана «Страница не загрузилась» клиентский плагин молчит до конца жизни документа: все
каналы (`vite:preloadError`, `app:chunkError`, `vue:error`, `app:error`, `unhandledrejection`, `error`) и poll не
делают ничего, `app:mounted` не убирает маркер `sdg-retry`. Зачем: уходящий документ живёт ещё секунды после
автоповтора, а навигация обрывает загрузку CSS его страницы ошибки — сбой доходит до guard уже после монтирования,
пробы не доходят до сервера, build-id совпадает, и в Sentry уходит ложный «билд актуален» (`not-stale`) от
документа, который уже умер (Sentry KP-MODMB-COM-1H, 21.10.2026). Второе следствие — маркер `sdg-retry` остаётся
в адресе: кнопка «Обновить» на экране перезагружает страницу С маркером, одно нажатие = одна попытка.

Ограничения:

- Inline-скрипт — как и inline-payload самого Nuxt, при строгом CSP ему нужен nonce/hash.
- Entry считается любой `<script type="module" src>`, который не загрузился до монтирования: чужие module-скрипты на
  странице получат тот же автоповтор.
- Маркер ищется в `location.search`, а плагин убирает его из query роутера: в hash-режиме vue-router
  (`#/path?query`) маркер остаётся в адресе.
- `router.replace` после монтирования меняет `route.query`: код, следящий за ним (`watch`, `useFetch({ watch })`),
  увидит одно изменение, а route middleware и хуки `page:start`/`page:finish` отработают для этой навигации ещё раз.

## SSR-документы: содержимое не прячем

Модуль написан для SPA, но Nuxt умеет рендерить на сервере часть страниц: приложение — SPA, а публичная страница —
настоящий SSR (`ssr: true` и `routeRules`, например `'/**': { ssr: false }`, `'/card/**': { ssr: true }`). Если у такого
документа не загрузился JS, страница не мертва: содержимое уже в HTML и читается, обычные ссылки (`<a href>`) работают
без JS. Оверлей «Загружаем страницу…» / «Страница не загрузилась» и автоперезагрузка накрыли бы работающую страницу,
поэтому на SSR-документе inline-скрипт из «Мёртвая первая загрузка» её не трогает. Так с 0.9.0.

**Метка.** В проде (`!nuxt.options.dev`, там же, где inline-скрипты) модуль подключает серверный Nuxt-плагин
`src/runtime/plugin.server.ts` (`mode: 'server'`): через `useHead({ htmlAttrs })` он ставит на `<html>` атрибут
`data-sdg-ssr=""`. Inline-скрипт читает его **один раз при старте** (атрибуты `<html>` разобраны раньше head-скриптов) и
дальше от атрибута не зависит: поздние правки `<html>` другим кодом ничего не меняют (клиентский unhead метку не
снимает — он убирает только свои атрибуты, и после гидрации она остаётся в DOM). Плагины Nuxt исполняются
только там, где на сервере создаётся приложение. SPA-оболочка (`ssr: false` — глобальный или `routeRules.ssr: false`,
запрос с заголовком `x-nuxt-no-ssr`) собирается рендерером без запуска приложения: метки в ней нет, и всё работает как
раньше. Проверено по исходникам Nuxt (`@nuxt/nitro-server/dist/runtime/utils/renderer/build-files.mjs`, 4.4.2 и 4.5.2):
`getRenderer` отдаёт `getSPARenderer()`, если `NUXT_NO_SSR || ssrContext.noSSR`, и только `getSSRRenderer()` вызывает
серверный entry. Границу держат e2e-тесты на прод-сборках фикстур `default` (`ssr: false`), `ssr` и `hybrid` (одна
сборка с маршрутами обоих видов).

**Что меняется на документе с меткой:**

| Ситуация                                                     | SPA-оболочка (без метки)                                 | SSR-документ (с меткой)                                     |
| ------------------------------------------------------------ | -------------------------------------------------------- | ----------------------------------------------------------- |
| Сбой чанка или entry до `app:mounted`, в URL нет `sdg-retry` | оверлей «Загружаем страницу…» и `location.replace`       | ничего: ни оверлея, ни перезагрузки, ни события             |
| То же на URL с `sdg-retry`                                   | экран «Страница не загрузилась» и событие `retry-failed` | ничего: ни экрана, ни события                               |
| `handled()` после такого сбоя                                | `true`                                                   | `true`: клиентский плагин молчит                            |
| Watchdog: зависли только скрипты                             | `app:load-timeout`                                       | тишина                                                      |
| Watchdog: завис стиль (`<link rel="stylesheet">`)            | `app:load-timeout`                                       | `app:load-timeout`: отрисовка заблокирована, страница пуста |

Сбой на SSR-документе помечает документ пережившим сбой и больше ничего не делает: `handled()` → `true`, и клиентский
плагин молчит до конца жизни документа — ни HEAD-проб, ни reload, ни `not-stale` (как после автоповтора в SPA).
Ошибка чанка по-прежнему глотается (`preventDefault`): страница остаётся такой, какой её отрисовал сервер. `kind`
поглощённого сбоя, если потом всё же придёт отчёт watchdog'а, попадёт в его `detail`.

Watchdog на SSR-документе решает в момент порога: зависший стиль — это критичный `<link rel="stylesheet">` (не
`alternate`, не `disabled`, `media` подходит) без записи Resource Timing; смотрят ВСЕ зависшие ресурсы, а не только пять
из `detail.pending`. Нет Resource Timing, он бросил или DOM не читается — зависших не определить, и SSR-документ молчит.
Формат `detail` тот же, что и у SPA-оболочки (`LoadTimeoutDetail`), контракт события не менялся.

Ограничения:

- Метку читает только скрипт «страница не загрузилась». Экран «браузер без import maps» её не учитывает: если цели
  сборки поддерживают import maps и в странице есть `<script type="importmap">`, браузер без них увидит экран и на
  SSR-документе.
- В dev плагин не подключается: inline-скриптов там нет, метку читать некому.
- Метка — часть контракта модуля: свой `data-sdg-ssr` на `<html>` SPA-оболочки отключит для неё экран и автоповтор.

## Палитра и тексты экранов

Оба inline-экрана модуля («браузер без import maps» и «страница не загрузилась») рисуются в палитре и с текстами
проекта: «в каждом проекте своя палитра». Значения запекаются в текст inline-скрипта на этапе сборки — скрипт
исполняется до старта приложения и `runtimeConfig` не читает.

- `theme` — палитра: `{ dark?: {...}, light?: {...} }`, поля `bg`, `fg`, `muted`, `accent`, `onAccent`, `line`,
  `fieldBg`. Тёмная тема по умолчанию, светлая — при `html.light` (класс `@nuxtjs/color-mode`) или, если на
  `<html>` нет `.dark`, при `prefers-color-scheme: light`. Любое поле переопределяется по отдельности: не задал —
  взяли дефолт (палитра ai.pushka.biz: тёмная `#1d161e`/`#c084fc`, светлая `#ffffff`/`#9333ea`).
- `texts` — тексты: заголовки, подсказки, кнопки, `aria-label` поля с адресом и сообщения после копирования
  ссылки. Любую строку можно переопределить по отдельности; `unsupportedIosAdvice` — массив абзацев, и
  пользовательский массив **заменяет** дефолтный (а не дополняет его).

Пример — синяя палитра kp (brand `#24a4ff`, primary 500 `#0086ec`) и свои тексты:

```ts
// nuxt.config.ts
export default defineNuxtConfig({
  modules: ['@mttzzz/nuxt-stale-deploy-guard'],
  staleDeployGuard: {
    theme: {
      dark: {
        bg: '#0b1220',
        fg: '#eaf2ff',
        muted: '#9fb4d4',
        accent: '#24a4ff',
        onAccent: '#0b1220',
        line: '#24344f',
        fieldBg: '#111a2b',
      },
      light: {
        bg: '#f5f9ff',
        fg: '#0b1220',
        muted: '#4a5b76',
        accent: '#0086ec',
        onAccent: '#ffffff',
        line: '#d6e4f7',
        fieldBg: '#ffffff',
      },
    },
    texts: {
      failedTitle: 'Страница не открылась',
      failedAdvice: 'Проверьте интернет и нажмите «Обновить».',
      reload: 'Обновить',
    },
  },
})
```

Проект, который ничего не переопределяет, получает ровно ту же картинку, что и до 0.7.0: дефолты — палитра
ai.pushka.biz и её русские тексты.

## Watchdog: приложение не загрузилось

Inline-скрипт «страница не загрузилась» (он в `<head>`, `tagPriority: -1` — раньше entry) копит **видимое** время с
момента своего исполнения. Когда накопилось `loadTimeoutMs` (дефолт 45 с), а приложение **не смонтировалось** и
пользователю **не показан** экран «страница не загрузилась» — скрипт один раз сообщает об этом событием на window:

```ts
window.dispatchEvent(new CustomEvent('app:load-timeout', { detail }))
```

Смысл: поймать «мёртвую первую загрузку» БЕЗ ошибки в консоли — зависший entry, минувший CDN, зависший стиль в
`<head>`, редирект на пустую страницу. Там, где ни один обработчик сбоя не сработал, в Sentry была тишина. А
диагностика в `detail` отвечает на следующий вопрос — _где_ именно застряла загрузка.

### Видимое время

Ждать таймером «на всё время» нельзя: у фоновой, замороженной и уснувшей вкладки таймеры спят или срабатывают с
опозданием, и отчёт «не загрузилось за 45 с» приходил от вкладки, которую никто не видел (Sentry KP-MODMB-COM-1J:
4 из 10 событий — восстановление сессии Chrome с девятью фоновыми вкладками, смонтировавшимися через 55–57 с, и
вкладка Android, замороженная на 2 мин). Поэтому скрипт считает только то, что вкладка пробыла на экране:

- раз в секунду срабатывает тик (`setInterval`) и прибавляет к счётчику `min(прошло с прошлого тика, 2 с)` — но только
  пока `document.visibilityState` не `hidden` (устаревшее `prerender` — тоже скрыта; нет свойства — вкладка видима);
- прошлый тик обновляется всегда, а `visibilitychange` при возврате во вкладку сбрасывает его заново: скрытый кусок не
  засчитывается;
- потолок в 2 с превращает «тиков не было, потом один с огромной разницей» (заморозка, сон ноутбука, скачок часов) в
  обычные 2 с, а не в десять минут «видимого» ожидания. Часы, ушедшие назад, счётчик не уменьшают;
- вкладка, которая так и не стала видимой, ничего не шлёт;
- отчёт уходит в момент достижения порога, одним событием на документ: ни дополнительных событий, ни отложенной
  отправки на `pagehide`. Тик раз в секунду, поэтому порог точен до секунды: отчёт приходит на первом тике после него;
- тик останавливается, когда приложение смонтировалось, после отчёта, на экране «страница не загрузилась» и на
  экране «браузер без import maps». `loadTimeoutMs: 0` — тика нет вовсе.

### `detail`

| Поле            | Тип                                      | Что это                                                                                                  |
| --------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `reason`        | `'load-timeout'`                         | всегда                                                                                                   |
| `timeoutMs`     | `number`                                 | порог видимого ожидания (опция `loadTimeoutMs`)                                                          |
| `visibleMs`     | `number`                                 | сколько видимого времени накопилось к отчёту (не меньше `timeoutMs`)                                     |
| `hiddenMs`      | `number`                                 | `max(0, elapsedMs - visibleMs)`: сколько вкладка была скрыта, заморожена или спала                       |
| `elapsedMs`     | `number`                                 | сколько прошло по часам (`Date.now()`) с исполнения скрипта                                              |
| `url`           | `string`                                 | адрес страницы                                                                                           |
| `kind`          | `'chunk' \| 'entry'` (необязат.)         | что не загрузилось, если скрипт к тому времени уже видел сбой                                            |
| `stage`         | `'network' \| 'boot'`                    | где застряла загрузка (правила ниже)                                                                     |
| `host`          | `string` (только при `network`)          | хост первого зависшего ресурса; зависших нет (документ ещё стримится) — `location.host`                  |
| `readyState`    | `string`                                 | `document.readyState` на момент отчёта                                                                   |
| `online`        | `boolean`                                | `navigator.onLine` (`true`, если свойства нет)                                                           |
| `pending`       | `string[]`                               | до 5 зависших критичных ресурсов в порядке документа, каждый `host + pathname` (без query и hash), ≤ 120 |
| `pendingCount`  | `number`                                 | сколько зависших ресурсов всего                                                                          |
| `criticalCount` | `number`                                 | сколько критичных ресурсов в документе                                                                   |
| `vueMounted`    | `boolean`                                | в документе есть `[data-v-app]`: Vue смонтирован, но плагин guard так и не вызвал `mounted()`            |
| `errors`        | `{ message: string; source?: string }[]` | первые три ошибки до монтирования (см. ниже)                                                             |

Тип — `LoadTimeoutDetail` в `src/runtime/chunk-reload-guard.ts`.

### Стадия и зависшие ресурсы

**Критичные ресурсы** — то, без чего приложение не стартует:

- `link[href]` с `rel` `stylesheet` — кроме `alternate`, `disabled` и непустого `media`, которому не отвечает
  `matchMedia(media)`;
- `link[href]` с `rel` `modulepreload`;
- `script[src]` — кроме классических (не `type="module"`) скриптов с `async` или `nomodule`. Браузер, исполняющий
  module-entry, `nomodule`-скрипты не грузит, поэтому они навсегда остались бы зависшими и могли бы стать «первым
  зависшим хостом». На `type="module"` атрибут `nomodule` не действует: такой скрипт грузится и критичен.

`prefetch`, `preload`, `icon`, `preconnect` не критичны.

**Зависший** (pending) — критичный ресурс, у которого нет записи в `performance.getEntriesByType('resource')`
(сравнение по абсолютному URL: `el.href` / `el.src` и `entry.name`). Запись появляется, когда загрузка завершилась, так
что нет записи — ресурс ещё грузится, не стартовал или упал. Нет Resource Timing или он бросил — `pending: []`,
`pendingCount: 0`; `criticalCount` считается всё равно.

**`stage`**:

- `network` — не пришли ресурсы документа: есть зависшие ИЛИ `readyState === 'loading'` (сам документ ещё стримится).
  `host` — хост первого зависшего ресурса, а если зависших нет — `location.host`. Зависший стиль в head оставляет
  `readyState` и `loading`, и `interactive` (в Chromium парсер доходит до конца разметки, если после стиля нет
  синхронных скриптов), поэтому стадию определяют зависшие ресурсы, а не один `readyState`;
- `boot` — всё пришло, а приложение не поднялось (ошибка старта, зависший top-level `await`). `host` нет.

### Ошибки до монтирования

`errors` — первые три ошибки, случившиеся ДО `app:mounted`: runtime-`error` на window (`ErrorEvent` с сообщением) и
`unhandledrejection`. `message` — `ErrorEvent.message`; у `unhandledrejection` — `reason.message`, если это строка,
иначе `String(reason)`; не длиннее 200 символов. `source` — `host + pathname:строка:колонка` из
`ErrorEvent.filename`, если он есть (у `unhandledrejection` и cross-origin «Script error.» его нет). Сбои загрузки
элементов (`<script>`, `<link>`, `<img>`) сюда не попадают: у сбоя `<script type="module">` entry есть свой канал
(автоповтор страницы).

### Примеры

Завис стиль с чужого хоста (`network`; ровно то, что утверждает тест `load-timeout-diagnostics.test.ts`):

```ts
{
  reason: 'load-timeout',
  timeoutMs: 30_000,
  visibleMs: 30_000,
  hiddenMs: 0,
  elapsedMs: 30_000,
  url: 'https://app.example.com/invite/abc?x=1#top',
  stage: 'network',
  host: 'fonts.googleapis.com',
  readyState: 'loading',
  online: true,
  pending: ['fonts.googleapis.com/css2'],
  pendingCount: 1,
  criticalCount: 5,
  vueMounted: false,
  errors: [],
}
```

Всё пришло, приложение упало при старте (`boot`):

```ts
{
  reason: 'load-timeout',
  timeoutMs: 30_000,
  visibleMs: 30_000,
  hiddenMs: 0,
  elapsedMs: 30_000,
  url: 'https://app.example.com/invite/abc?x=1#top',
  stage: 'boot',
  readyState: 'complete',
  online: true,
  pending: [],
  pendingCount: 0,
  criticalCount: 5,
  vueMounted: false,
  errors: [
    {
      message: "Uncaught TypeError: Cannot read properties of undefined (reading 'use')",
      source: 'cdn.example.com/_nuxt/entry.js:1:40213',
    },
    { message: 'Hydration failed' },
  ],
}
```

### Когда watchdog молчит

- приложение смонтировалось (клиентский плагин сообщил мосту `mounted()`);
- показан экран «страница не загрузилась» — про него уже есть событие `retry-failed`;
- сработал экран «браузер без import maps» (`window.__sdgDeadLoad.takenOver`) — про него уже есть событие
  `unsupported-browser`;
- вкладка так и не стала видимой;
- документ отрендерен на сервере (метка `data-sdg-ssr`), а среди зависших критичных ресурсов нет стиля — страница
  читается (см. «SSR-документы»).

Оверлей автоповтора («Загружаем страницу…») watchdog **не** гасит: страница должна была уйти на перезагрузку; если за
порог видимого времени не ушла — это ровно тот случай, о котором нужен отчёт (в `detail` попадает `kind` увиденного
сбоя). Отчёт за документ — ровно один. `loadTimeoutMs: 0` — watchdog выключен.

Ограничение диагностики: запись Resource Timing хранится в буфере (по умолчанию 250 записей, картинки и запросы
занимают те же места) — переполнился, и ресурсы, загруженные позже, числятся зависшими.

### Sentry

В Sentry этот отчёт отправляет **только** ранний inline-beacon `@mttzzz/nuxt-sentry` (SDK к этому моменту может
ещё не подняться, а клиентский плагин Sentry вообще не стартует, если приложение не смонтировалось). Поэтому guard
**≥ 0.8.0** ставится парой с **nuxt-sentry ≥ 0.13.0**: он раскладывает отчёты по стадиям — отдельная issue на `network`
(для неё ещё и по хосту первого зависшего ресурса) и на `boot`, а поля `detail` доезжают тегами `load.*` и контекстом
`load`. nuxt-sentry 0.12.x понимает событие, но стадий не знает: все отчёты ложатся в одну issue. Отчётов с SDK-пути
нет — дубля не получается. Версия 0.9.0 формат события не меняет: отличие только в том, когда оно приходит (на
SSR-документе — реже, см. «SSR-документы»), поэтому пара остаётся прежней.

## Опции

| Опция               | Default                             | Описание                                            |
| ------------------- | ----------------------------------- | --------------------------------------------------- |
| `buildIdHeader`     | `'x-app-build-id'`                  | имя header'а с build-id                             |
| `htmlPaths`         | `['/**']`                           | пути с no-cache,must-revalidate                     |
| `immutablePaths`    | `['/_nuxt/**']`                     | immutable пути                                      |
| `apiPaths`          | `['/api/**']`                       | no-store пути                                       |
| `serviceWorkerPath` | `'/service-worker.js'`              | SW путь                                             |
| `pollIntervalMs`    | `0`                                 | проактивный poll, 0 = выкл                          |
| `cooldownMs`        | `10_000`                            | cooldown между verify                               |
| `circuitBreaker`    | `{maxAttempts:3, windowMs:300_000}` | защита от infinite reload                           |
| `theme`             | палитра ai.pushka.biz               | палитра экранов (dark/light)                        |
| `texts`             | русские тексты ai.pushka.biz        | тексты экранов                                      |
| `loadTimeoutMs`     | `45_000`                            | watchdog «не загрузилось» (видимое время), 0 = выкл |

User-defined `routeRules` имеют приоритет над дефолтами модуля (через `defu(user, ours)`).

## Разработка

```bash
bun install
bun run dev:prepare    # генерит .nuxt/ и dist stub
bun run dev            # playground на localhost:3000
bun run test           # unit (vitest + happy-dom) и e2e (сборка фикстур Nuxt)
bun run prepack        # билд dist/ через @nuxt/module-builder
```

## License

MIT
