import MyModule from '../../../src/module'

export default defineNuxtConfig({
  ssr: false,
  modules: [MyModule],
  compatibilityDate: '2025-10-25',
  routeRules: {
    /* user routeRule на конкретный путь — должен победить дефолтный no-store от модуля */
    '/api/sensitive': { headers: { 'cache-control': 'private, max-age=60' } },
  },
})
