import { addPlugin, addServerPlugin, createResolver, defineNuxtModule } from '@nuxt/kit'
import { defu } from 'defu'

import type { ModuleOptions, ResolvedModuleOptions } from './runtime/types'

export type { ModuleOptions } from './runtime/types'

const DEFAULTS: ResolvedModuleOptions = {
  buildIdHeader: 'x-app-build-id',
  htmlPaths: ['/**'],
  immutablePaths: ['/_nuxt/**'],
  apiPaths: ['/api/**'],
  serviceWorkerPath: '/service-worker.js',
  pollIntervalMs: 60_000,
  cooldownMs: 10_000,
  circuitBreaker: { maxAttempts: 3, windowMs: 5 * 60_000 },
}

export default defineNuxtModule<ModuleOptions>({
  meta: {
    name: '@mttzzz/nuxt-stale-deploy-guard',
    configKey: 'staleDeployGuard',
    compatibility: { nuxt: '^4.0.0' },
  },
  /*
   * defaults пустой намеренно: defineNuxtModule(...defaults) применяет defu(user, defaults),
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

    /* 3) Server plugin (Nitro) */
    addServerPlugin(resolver.resolve('./runtime/server/plugin'))

    /* 4) Client plugin */
    addPlugin({ src: resolver.resolve('./runtime/plugin.client'), mode: 'client' })
  },
})

declare module 'nuxt/schema' {
  interface RuntimeConfig {
    public: RuntimeConfig['public'] & {
      staleDeployGuard?: ResolvedModuleOptions
    }
  }
}
