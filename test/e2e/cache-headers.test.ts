import { fileURLToPath } from 'node:url'

import { $fetch, fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

await setup({
  rootDir: fileURLToPath(new URL('../fixtures/default', import.meta.url)),
})

describe('cache headers — fixture: default', () => {
  it('GET / → no-cache, must-revalidate (HTML защищён от Safari heuristic)', async () => {
    const res = await fetch('/', { redirect: 'manual' })
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toMatch(/no-cache|no-store|must-revalidate/)
  })

  it('GET /_nuxt/<chunk>.js → immutable', async () => {
    const html = await $fetch<string>('/')
    const m = html.match(/\/_nuxt\/[\w-]+\.js/)
    expect(m, 'chunk url не найден в HTML').toBeTruthy()
    const res = await fetch(m![0])
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toMatch(/immutable|max-age=\d{7,}/)
  })

  it('GET /api/foo → no-store', async () => {
    const res = await fetch('/api/foo')
    expect(res.headers.get('cache-control') ?? '').toMatch(/no-store/)
  })

  it('Любой response несёт x-app-build-id', async () => {
    const res = await fetch('/api/foo')
    expect(res.headers.get('x-app-build-id')).toBeTruthy()
  })
})
