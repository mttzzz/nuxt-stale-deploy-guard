import MyModule from '../../../src/module'

export default defineNuxtConfig({
  ssr: false,
  modules: [MyModule],
  compatibilityDate: '2025-10-25',
  staleDeployGuard: {
    buildIdHeader: 'x-foo-build',
    apiPaths: ['/api/v2/**'],
  },
})
