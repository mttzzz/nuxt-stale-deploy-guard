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
import {
  createSentryStaleChunkFilter,
  STALE_CHUNK_PATTERNS,
} from '@mttzzz/nuxt-stale-deploy-guard/sentry'

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
  HEAD-запрос на текущий путь → если build-id отличается → reload через `reloadNuxtApp`.
- Cooldown 10s + circuit breaker (3 попытки в 5 мин). Превышение — `dispatchEvent('app:chunk-reload-blocked')`.
- Passive poll: `setInterval(pollIntervalMs)`, `online`, `visibilitychange`, `router.beforeEach`.

## Опции

| Опция | Default | Описание |
|-------|---------|----------|
| `buildIdHeader` | `'x-app-build-id'` | имя header'а с build-id |
| `htmlPaths` | `['/**']` | пути с no-cache,must-revalidate |
| `immutablePaths` | `['/_nuxt/**']` | immutable пути |
| `apiPaths` | `['/api/**']` | no-store пути |
| `serviceWorkerPath` | `'/service-worker.js'` | SW путь |
| `pollIntervalMs` | `60_000` | passive poll, 0 = выкл |
| `cooldownMs` | `10_000` | cooldown между verify |
| `circuitBreaker` | `{maxAttempts:3, windowMs:300_000}` | защита от infinite reload |

User-defined `routeRules` имеют приоритет над дефолтами модуля (через `defu(user, ours)`).

## Разработка

```bash
bun install
bun run dev:prepare    # генерит .nuxt/ и dist stub
bun run dev            # playground на localhost:3000
bun test               # 52 unit + e2e теста
bun run prepack        # билд dist/ через @nuxt/module-builder
```

## License

MIT
