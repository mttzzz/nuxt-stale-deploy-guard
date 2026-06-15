import { fileURLToPath } from 'node:url'

import { fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

await setup({
  rootDir: fileURLToPath(new URL('../fixtures/user-override', import.meta.url)),
})

describe('routeRules precedence — user wins over module defaults', () => {
  it('user-defined /api/sensitive → private, max-age=60 (no-store от модуля отступает)', async () => {
    const res = await fetch('/api/sensitive')
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).toMatch(/private/u)
    expect(cc).toMatch(/max-age=60/u)
    expect(cc).not.toMatch(/no-store/u)
  })

  it('GET /api/other → no-store (модульный дефолт)', async () => {
    const res = await fetch('/api/other')
    expect(res.headers.get('cache-control') ?? '').toMatch(/no-store/u)
  })
})
