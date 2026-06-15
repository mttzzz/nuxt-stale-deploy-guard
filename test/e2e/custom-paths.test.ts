import { fileURLToPath } from 'node:url'

import { fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

await setup({
  rootDir: fileURLToPath(new URL('../fixtures/custom-paths', import.meta.url)),
})

describe('cache headers — fixture: custom-paths', () => {
  it('кастомное имя header — x-foo-build', async () => {
    const res = await fetch('/api/v1/foo')
    expect(res.headers.get('x-foo-build')).toBeTruthy()
    expect(res.headers.get('x-app-build-id')).toBeNull()
  })

  it('GET /api/v2/foo → no-store (внутри apiPaths)', async () => {
    const res = await fetch('/api/v2/foo')
    expect(res.headers.get('cache-control') ?? '').toMatch(/no-store/u)
  })

  it('GET /api/v1/foo → НЕ no-store (вне apiPaths)', async () => {
    const res = await fetch('/api/v1/foo')
    const cc = res.headers.get('cache-control') ?? ''
    expect(cc).not.toMatch(/no-store/u)
    expect(cc).toMatch(/no-cache|must-revalidate/u)
  })
})
