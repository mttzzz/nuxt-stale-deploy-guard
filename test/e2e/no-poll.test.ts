import { fileURLToPath } from 'node:url'

import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { describe, expect, it } from 'vitest'

await setup({
  rootDir: fileURLToPath(new URL('../fixtures/no-poll', import.meta.url)),
})

describe('smoke — fixture: no-poll', () => {
  it('runtimeConfig.public.staleDeployGuard.pollIntervalMs выставлен в 0', async () => {
    const html = await $fetch<string>('/')
    /* SPA отдаёт пустую div'ку, но inlines runtime config — там и проверяем */
    /* Inline config — JS-объект, ключи без кавычек: `pollIntervalMs:0` */
    expect(html).toMatch(/pollIntervalMs:0[,}]/)
  })

  it('Nuxt SPA-индекс рендерится без 5xx', async () => {
    const html = await $fetch<string>('/')
    expect(html).toContain('id="__nuxt"')
  })
})
