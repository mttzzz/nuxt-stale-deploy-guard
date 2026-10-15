import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      /* Nuxt-алиас `#app` существует только внутри сборки Nuxt; в unit-тестах плагина (plugin-client.test.ts)
         его место занимает заглушка. E2E-сборки фикстур этот алиас не затрагивает. */
      '#app': fileURLToPath(new URL('test/unit/stubs/nuxt-app.ts', import.meta.url)),
    },
  },
})
