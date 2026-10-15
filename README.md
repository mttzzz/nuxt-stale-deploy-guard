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
- Ловит `vite:preloadError`, `app:chunkError`, `vue:error`, `unhandledrejection`, `error` →
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

| `reason`              | Когда                                                                                         | Поля                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `not-stale`           | реактивная верификация: ни одна проба не увидела чужой build-id — чанк сломан не деплоем      | `error`, `probes: string[]`, `buildId: string`                       |
| `circuit-breaker`     | реактивная верификация хотела reload, circuit breaker запретил                                | `error`, `probes`, `buildId`, `attempts: number`, `windowMs: number` |
| `cooldown`            | реактивная верификация пропущена: идёт cooldown после reload (чанк упал сразу после reload'а) | `error`, `buildId`                                                   |
| `no-build-id`         | реактивная верификация пропущена: у клиента нет build-id                                      | `error`                                                              |
| `unsupported-browser` | inline-скрипт: браузер без import maps, приложение не стартует (см. ниже)                     | `missing: 'importmap'`                                               |

`error` — исходная ошибка/значение, запустившее верификацию: payload `vite:preloadError`, `reason`
`unhandledrejection`, `error ?? message` события `error`, ошибка `vue:error`/`app:error`, `error` из хука
`app:chunkError` (`{ error }`). Ключ есть всегда, значение может быть `undefined`. `probes` — build-id каждой
пробы (пустая строка — проба упала или ответила без заголовка).

Событие НЕ шлётся:

- при reload — вкладку лечит сам reload;
- когда вызов упёрся в идущую верификацию (`verifyInFlight`): свой исход отправит она;
- poll-вердиктом (`pollIntervalMs > 0`) — ни при каком исходе, включая его circuit breaker.

Событие `unsupported-browser` приходит до старта приложения (Nuxt-плагины не запускаются вовсе), поэтому
слушать его должен ранний inline-скрипт в `<head>` (`tagPosition: 'head'`), а не клиентский плагин.

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
3. Шлёт `app:chunk-reload-blocked` с `{ reason: 'unsupported-browser', missing: 'importmap' }`.
4. Вызывает `window.stop()`: парсер прерывается, module-скрипты entry не исполняются, **приложение не
   стартует** (ни hydration, ни Sentry SDK).
5. Рисует экран на всю страницу (fixed, `z-index: 2147483647`):
   - iPhone/iPad (`iPhone|iPad|iPod` в UA либо `Macintosh` + `maxTouchPoints > 1`): «Версия iOS устарела»,
     «Нужна iOS 16.4 или новее: Настройки → Основные → Обновление ПО. Другой браузер на этом устройстве не
     поможет.» и «Если обновление недоступно, скопируйте ссылку и откройте её на компьютере.»;
   - остальные: «Браузер устарел», «Обновите браузер или откройте эту ссылку в другом браузере.»;
   - адрес страницы в поле только для чтения и кнопка «Скопировать ссылку» (`navigator.clipboard.writeText`,
     фолбэк — выделить поле и `document.execCommand('copy')`); после успеха «Ссылка скопирована», при отказе —
     «Не удалось скопировать — выделите адрес вручную».

Оформление — палитра ai.pushka.biz: тёмная по умолчанию (фон `#1d161e`, акцент `#c084fc`), светлая при
`html.light` (класс `@nuxtjs/color-mode`) или, если на `<html>` нет `.dark`, при `prefers-color-scheme: light`
(фон `#ffffff`, акцент `#9333ea`). Маркеры для интеграционных проверок: корневой элемент оверлея несёт
атрибут `data-sdg-unsupported`, кнопка — настоящий `<button type="button">`.

Скрипт написан на синтаксисе ES5 (разбирается любым древним браузером), DOM строится через
`createElement`/`textContent`. Это inline-скрипт — как и inline-payload самого Nuxt: при строгом CSP ему нужен
nonce/hash. Известное ограничение: Chrome/Edge 89–95 поддерживают import maps, но не имеют
`HTMLScriptElement.supports` (появился в 96) — их «метода нет» тоже приводит к экрану.

## Опции

| Опция               | Default                             | Описание                        |
| ------------------- | ----------------------------------- | ------------------------------- |
| `buildIdHeader`     | `'x-app-build-id'`                  | имя header'а с build-id         |
| `htmlPaths`         | `['/**']`                           | пути с no-cache,must-revalidate |
| `immutablePaths`    | `['/_nuxt/**']`                     | immutable пути                  |
| `apiPaths`          | `['/api/**']`                       | no-store пути                   |
| `serviceWorkerPath` | `'/service-worker.js'`              | SW путь                         |
| `pollIntervalMs`    | `0`                                 | проактивный poll, 0 = выкл      |
| `cooldownMs`        | `10_000`                            | cooldown между verify           |
| `circuitBreaker`    | `{maxAttempts:3, windowMs:300_000}` | защита от infinite reload       |

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
