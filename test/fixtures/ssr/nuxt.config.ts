import MyModule from '../../../src/module'

export default defineNuxtConfig({
  modules: [MyModule],
  compatibilityDate: '2025-10-25',
  /* Nuxt 4.1+ кладёт entry в import map только если ВСЕ цели сборки её поддерживают; esnext снимает ограничение. */
  vite: { build: { target: 'esnext' } },
})
