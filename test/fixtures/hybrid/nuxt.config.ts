import MyModule from '../../../src/module'

export default defineNuxtConfig({
  modules: [MyModule],
  compatibilityDate: '2025-10-25',
  /* Раскладка kp.modmb.com: приложение — SPA, сервером рендерится только публичная карточка. Глобальный `ssr: false`
     не годится: он зашивает NUXT_NO_SSR, и `ssr: true` в routeRules игнорируется. */
  routeRules: {
    '/**': { ssr: false },
    '/card/**': { ssr: true },
  },
})
