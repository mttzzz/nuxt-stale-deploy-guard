import { fileURLToPath } from 'node:url'

import { $fetch, setup } from '@nuxt/test-utils/e2e'
import { afterEach } from 'vitest'

import { closeBuiltPages } from './helpers/built-page'
import { deadLoadSuite, spaShellSuite } from './helpers/dead-load-suite'

/*
 * Fixture `default`: SPA (`ssr: false`) — раскладка тегов как у kp.modmb.com, где и случился Sentry KP-MODMB-COM-1H:
 * entry `<script type="module">` в head, import map нет. Серверное приложение не создаётся вовсе, поэтому метки
 * `data-sdg-ssr` в оболочке нет и сбой entry по-прежнему закрывается оверлеем и автоповтором (spaShellSuite).
 */
await setup({
  rootDir: fileURLToPath(new URL('../fixtures/default', import.meta.url)),
})

afterEach(closeBuiltPages)

deadLoadSuite(async () => $fetch<string>('/'))
spaShellSuite(async () => $fetch<string>('/'))
