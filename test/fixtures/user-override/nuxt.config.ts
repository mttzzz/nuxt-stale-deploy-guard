import MyModule from '../../../src/module'

export default defineNuxtConfig({
  modules: [MyModule],
  ssr: false,
  routeRules: {
    /* user routeRule на конкретный путь — должен победить дефолтный no-store от модуля */
    '/api/sensitive': { headers: { 'cache-control': 'private, max-age=60' } },
  },
  compatibilityDate: '2025-10-25',
})
