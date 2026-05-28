import { defineNuxtModule, createResolver, addServerPlugin, addPlugin } from '@nuxt/kit';
import { defu } from 'defu';

const DEFAULTS = {
  buildIdHeader: "x-app-build-id",
  htmlPaths: ["/**"],
  immutablePaths: ["/_nuxt/**"],
  apiPaths: ["/api/**"],
  serviceWorkerPath: "/service-worker.js",
  pollIntervalMs: 6e4,
  cooldownMs: 1e4,
  circuitBreaker: { maxAttempts: 3, windowMs: 5 * 6e4 },
  skipInDev: true
};
function shouldEnableClientGuard(opts, isDev) {
  if (opts.skipInDev && isDev) {
    return false;
  }
  return true;
}
const module$1 = defineNuxtModule({
  meta: {
    name: "@mttzzz/nuxt-stale-deploy-guard",
    configKey: "staleDeployGuard",
    compatibility: { nuxt: "^4.0.0" }
  },
  /*
   * defaults пустой намеренно: defineNuxtModule(...defaults) применяет defu(user, defaults),
   * а defu конкатенирует массивы (['/api/v2/**'] + ['/api/**']). Нам нужен replace на массивах,
   * поэтому раскрываем дефолты вручную ниже через `??`.
   */
  defaults: {},
  setup(opts, nuxt) {
    const resolver = createResolver(import.meta.url);
    const resolved = {
      buildIdHeader: opts.buildIdHeader ?? DEFAULTS.buildIdHeader,
      htmlPaths: opts.htmlPaths ?? DEFAULTS.htmlPaths,
      immutablePaths: opts.immutablePaths ?? DEFAULTS.immutablePaths,
      apiPaths: opts.apiPaths ?? DEFAULTS.apiPaths,
      serviceWorkerPath: opts.serviceWorkerPath ?? DEFAULTS.serviceWorkerPath,
      pollIntervalMs: opts.pollIntervalMs ?? DEFAULTS.pollIntervalMs,
      cooldownMs: opts.cooldownMs ?? DEFAULTS.cooldownMs,
      circuitBreaker: defu(opts.circuitBreaker, DEFAULTS.circuitBreaker),
      skipInDev: opts.skipInDev ?? DEFAULTS.skipInDev
    };
    const ourRules = {};
    for (const p of resolved.htmlPaths) {
      ourRules[p] = { headers: { "cache-control": "no-cache, must-revalidate" } };
    }
    for (const p of resolved.immutablePaths) {
      ourRules[p] = { headers: { "cache-control": "public, max-age=31536000, immutable" } };
    }
    for (const p of resolved.apiPaths) {
      ourRules[p] = { headers: { "cache-control": "no-store" } };
    }
    ourRules[resolved.serviceWorkerPath] = {
      headers: {
        "cache-control": "no-cache, no-store, must-revalidate",
        "service-worker-allowed": "/"
      }
    };
    nuxt.options.routeRules = defu(nuxt.options.routeRules, ourRules);
    nuxt.options.runtimeConfig.public.staleDeployGuard = defu(
      nuxt.options.runtimeConfig.public.staleDeployGuard,
      resolved
    );
    addServerPlugin(resolver.resolve("./runtime/server/plugin"));
    if (shouldEnableClientGuard(resolved, nuxt.options.dev)) {
      addPlugin({ src: resolver.resolve("./runtime/plugin.client"), mode: "client" });
    }
  }
});

export { module$1 as default, shouldEnableClientGuard };
