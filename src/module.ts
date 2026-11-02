import { addPlugin, addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'

import {
  buildDeadLoadScript,
  DEAD_LOAD_SCRIPT_KEY,
  DEAD_LOAD_SCRIPT_PRIORITY,
  DEFAULT_LOAD_TIMEOUT_MS,
} from './runtime/dead-load'
import { buildImportmapCheckScript, IMPORTMAP_CHECK_SCRIPT_KEY } from './runtime/importmap-check'
import { resolveScreenTexts, resolveScreenTheme } from './runtime/screen-config'
import type { ModuleOptions, ResolvedModuleOptions } from './runtime/types'

export type { ModuleOptions } from './runtime/types'

const DEFAULTS: ResolvedModuleOptions = {
  buildIdHeader: 'x-app-build-id',
  htmlPaths: ['/**'],
  immutablePaths: ['/_nuxt/**'],
  apiPaths: ['/api/**'],
  serviceWorkerPath: '/service-worker.js',
  pollIntervalMs: 0,
  cooldownMs: 10_000,
  circuitBreaker: { maxAttempts: 3, windowMs: 5 * 60_000 },
  skipInDev: true,
  theme: resolveScreenTheme(),
  texts: resolveScreenTexts(),
  loadTimeoutMs: DEFAULT_LOAD_TIMEOUT_MS,
}

/* Чистая функция для решения «подключать ли client guard» — extract для unit-теста.
   В dev guard ловит Vite HMR preloadError-ы (503 на стержневые chunks во время rebuild) и
   force-reload'ит страницу, создавая false-positive «приложение лежит». Disable by default. */
export function shouldEnableClientGuard(opts: ResolvedModuleOptions, isDev: boolean): boolean {
  if (opts.skipInDev && isDev) {
    return false
  }
  return true
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@mttzzz/nuxt-stale-deploy-guard',
    configKey: 'staleDeployGuard',
    compatibility: { nuxt: '^4.0.0' },
  },
  /*
   * Defaults пустой намеренно: defineNuxtModule(...defaults) применяет defu(user, defaults),
   * а defu конкатенирует массивы (['/api/v2/**'] + ['/api/**']). Нам нужен replace на массивах,
   * поэтому раскрываем дефолты вручную ниже через `??`.
   */
  defaults: {},
  setup(opts, nuxt) {
    const resolver = createResolver(import.meta.url)
    const resolved: ResolvedModuleOptions = {
      buildIdHeader: opts.buildIdHeader ?? DEFAULTS.buildIdHeader,
      htmlPaths: opts.htmlPaths ?? DEFAULTS.htmlPaths,
      immutablePaths: opts.immutablePaths ?? DEFAULTS.immutablePaths,
      apiPaths: opts.apiPaths ?? DEFAULTS.apiPaths,
      serviceWorkerPath: opts.serviceWorkerPath ?? DEFAULTS.serviceWorkerPath,
      pollIntervalMs: opts.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
      cooldownMs: opts.cooldownMs ?? DEFAULTS.cooldownMs,
      circuitBreaker: defu(opts.circuitBreaker, DEFAULTS.circuitBreaker),
      skipInDev: opts.skipInDev ?? DEFAULTS.skipInDev,
      theme: resolveScreenTheme(opts.theme),
      texts: resolveScreenTexts(opts.texts),
      loadTimeoutMs: opts.loadTimeoutMs ?? DEFAULTS.loadTimeoutMs,
    }

    /*
     * 1) routeRules: defu(user, ours) → user wins. Конкретные пути перекрывают
     *    глобальные через стандартный nitro pattern matching.
     */
    const ourRules: Record<string, { headers: Record<string, string> }> = {}
    for (const p of resolved.htmlPaths) {
      ourRules[p] = { headers: { 'cache-control': 'no-cache, must-revalidate' } }
    }
    for (const p of resolved.immutablePaths) {
      ourRules[p] = { headers: { 'cache-control': 'public, max-age=31536000, immutable' } }
    }
    for (const p of resolved.apiPaths) {
      ourRules[p] = { headers: { 'cache-control': 'no-store' } }
    }
    ourRules[resolved.serviceWorkerPath] = {
      headers: {
        'cache-control': 'no-cache, no-store, must-revalidate',
        'service-worker-allowed': '/',
      },
    }
    nuxt.options.routeRules = defu(nuxt.options.routeRules, ourRules)

    /*
     * 2) Опции в runtimeConfig.public — доступны и на сервере (server-plugin),
     *    и на клиенте (plugin.client). Все опции сериализуемы (JSON-types).
     */
    nuxt.options.runtimeConfig.public.staleDeployGuard = defu(
      nuxt.options.runtimeConfig.public.staleDeployGuard as object | undefined,
      resolved,
    ) as ResolvedModuleOptions

    /* 3) Server plugin (Nitro) — оставляем всегда: cache-headers нужны и в dev для корректности. */
    addServerPlugin(resolver.resolve('./runtime/server/plugin'))

    /* 4) Client plugin — в dev пропускаем (см. shouldEnableClientGuard + skipInDev option). */
    if (shouldEnableClientGuard(resolved, nuxt.options.dev)) {
      addPlugin({ src: resolver.resolve('./runtime/plugin.client'), mode: 'client' })
    }

    /*
     * 5) Inline-скрипты первой загрузки — только прод: в dev import map нет, а экраны не должны реагировать на HMR.
     *    а) «Страница не загрузилась» (dead-load.ts, Sentry KP-MODMB-COM-1H): сбой чанка/entry ДО `app:mounted`
     *       оставлял вкладку мёртвой на 500 Nuxt — `nuxt:router` (enforce: 'pre') стартует первую навигацию раньше
     *       клиентского плагина. Скрипт — одна автоперезагрузка с маркером `sdg-retry` (её тратит и reload guard'а:
     *       страница, открытая им меньше cooldown'а назад, повтора не получает), после повторного сбоя экран
     *       с кнопкой «Обновить» и событие `retry-failed`. tagPosition head + числовой tagPriority: слушатели
     *       обязаны стоять в HTML РАНЬШЕ entry `<script type="module">`.
     *    б) Проверка import maps + экран для браузеров без них (iOS < 16.4: Nuxt 4.1+ кладёт entry в
     *       `<script type="importmap">`, без поддержки страница падает на 500 `Module specifier '#entry'`, а
     *       guard молча глотает ошибку — прод-инцидент ai.pushka.biz 15.10.2026). bodyClose: importmap из head
     *       уже в DOM, скрипт исполняется при парсинге — раньше deferred module-скриптов entry.
     *    в) Метка SSR (plugin.server.ts): серверный плагин ставит `<html data-sdg-ssr="">` на документ, отрендеренный
     *       на сервере, а скрипт «страница не загрузилась» на таком документе не прячет содержимое (ни оверлея, ни
     *       перезагрузки, ни события). В SPA-оболочке плагины на сервере не исполняются — метки там нет. Читает метку
     *       только этот скрипт, поэтому плагин подключается в том же условии, что и скрипты (в dev их нет).
     *
     *    Палитра и тексты экранов — опции модуля (`theme`, `texts`): они запекаются в текст скриптов на
     *    этапе сборки (скрипт исполняется до старта приложения и runtimeConfig не читает).
     */
    if (!nuxt.options.dev) {
      const screenConfig = { theme: resolved.theme, texts: resolved.texts }
      nuxt.options.app.head.script ??= []
      nuxt.options.app.head.script.push(
        {
          key: DEAD_LOAD_SCRIPT_KEY,
          innerHTML: buildDeadLoadScript({ ...screenConfig, loadTimeoutMs: resolved.loadTimeoutMs }),
          tagPosition: 'head',
          tagPriority: DEAD_LOAD_SCRIPT_PRIORITY,
        },
        {
          key: IMPORTMAP_CHECK_SCRIPT_KEY,
          innerHTML: buildImportmapCheckScript(screenConfig),
          tagPosition: 'bodyClose',
        },
      )
      addPlugin({ src: resolver.resolve('./runtime/plugin.server'), mode: 'server' })
    }
  },
})

declare module 'nuxt/schema' {
  interface PublicRuntimeConfig {
    staleDeployGuard?: ResolvedModuleOptions
  }
}
