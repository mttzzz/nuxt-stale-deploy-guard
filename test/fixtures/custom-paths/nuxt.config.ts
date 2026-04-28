import MyModule from '../../../src/module'

export default defineNuxtConfig({
  modules: [MyModule],
  ssr: false,
  compatibilityDate: '2025-10-25',
  staleDeployGuard: {
    buildIdHeader: 'x-foo-build',
    apiPaths: ['/api/v2/**'],
  },
})
