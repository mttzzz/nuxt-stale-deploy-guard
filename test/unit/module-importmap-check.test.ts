import { fileURLToPath } from 'node:url'

import { loadNuxt } from '@nuxt/kit'
import { describe, expect, it } from 'vitest'

import { IMPORTMAP_CHECK_SCRIPT, IMPORTMAP_CHECK_SCRIPT_KEY } from '../../src/runtime/importmap-check'

/*
 * Как модуль кладёт inline-проверку import maps в `app.head.script` — на настоящем Nuxt (loadNuxt поднимает
 * конфиг и запускает setup модуля без сборки). Прод: один скрипт в bodyClose; dev: ничего (в dev import map
 * нет, а экран «браузер устарел» не должен реагировать на HMR).
 */

const FIXTURE = fileURLToPath(new URL('../fixtures/default', import.meta.url))

async function headScripts(options: { dev: boolean; userScripts?: { src: string }[] }) {
  const nuxt = await loadNuxt({
    cwd: FIXTURE,
    dev: options.dev,
    overrides: {
      devtools: { enabled: false },
      telemetry: false,
      app: { head: { script: options.userScripts ?? [] } },
    },
  })
  try {
    return nuxt.options.app.head.script ?? []
  } finally {
    await nuxt.close()
  }
}

describe('модуль — inline-проверка import maps в app.head.script', { timeout: 60_000 }, () => {
  it('прод: один скрипт, bodyClose, с ключом дедупа и текстом проверки', async () => {
    expect(await headScripts({ dev: false })).toEqual([
      { key: IMPORTMAP_CHECK_SCRIPT_KEY, innerHTML: IMPORTMAP_CHECK_SCRIPT, tagPosition: 'bodyClose' },
    ])
  })

  it('dev: скрипта нет', async () => {
    expect(await headScripts({ dev: true })).toEqual([])
  })

  it('прод: скрипты приложения сохраняются, проверка добавляется после них', async () => {
    const scripts = await headScripts({ dev: false, userScripts: [{ src: '/analytics.js' }] })
    expect(scripts).toEqual([
      { src: '/analytics.js' },
      { key: IMPORTMAP_CHECK_SCRIPT_KEY, innerHTML: IMPORTMAP_CHECK_SCRIPT, tagPosition: 'bodyClose' },
    ])
  })
})
