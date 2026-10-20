import { fileURLToPath } from 'node:url'

import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { afterEach } from 'vitest'

import { closeBuiltPages } from './helpers/built-page'
import { deadLoadSuite } from './helpers/dead-load-suite'

/*
 * Fixture `default`: SPA (`ssr: false`) — раскладка тегов как у kp.modmb.com, где и случился Sentry KP-MODMB-COM-1H:
 * entry `<script type="module">` в head, import map нет. Те же проверки, что и для SSR-фикстуры, на своей сборке.
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/default', import.meta.url)),
})

afterEach(closeBuiltPages)

deadLoadSuite(async () => $fetch<string>('/'))
