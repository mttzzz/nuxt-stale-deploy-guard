import { fileURLToPath } from 'node:url'

import { loadNuxt } from '@nuxt/kit'
import { describe, expect, it } from 'vitest'

import { DEAD_LOAD_SCRIPT, DEAD_LOAD_SCRIPT_KEY, DEAD_LOAD_SCRIPT_PRIORITY } from '../../src/runtime/dead-load'
import { IMPORTMAP_CHECK_SCRIPT, IMPORTMAP_CHECK_SCRIPT_KEY } from '../../src/runtime/importmap-check'

/*
 * Как модуль кладёт inline-скрипты первой загрузки в `app.head.script` — на настоящем Nuxt (loadNuxt поднимает
 * конфиг и запускает setup модуля без сборки). Прод: «страница не загрузилась» в head (с числовым tagPriority —
 * слушатели обязаны стоять раньше entry) и проверка import maps в bodyClose; dev: ничего (в dev import map нет,
 * а экраны не должны реагировать на HMR).
 */

const FIXTURE = fileURLToPath(new URL('../fixtures/default', import.meta.url))

const DEAD_LOAD = {
  key: DEAD_LOAD_SCRIPT_KEY,
  innerHTML: DEAD_LOAD_SCRIPT,
  tagPosition: 'head',
  tagPriority: DEAD_LOAD_SCRIPT_PRIORITY,
}
const IMPORTMAP_CHECK = { key: IMPORTMAP_CHECK_SCRIPT_KEY, innerHTML: IMPORTMAP_CHECK_SCRIPT, tagPosition: 'bodyClose' }

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

describe('модуль — inline-скрипты первой загрузки в app.head.script', { timeout: 60_000 }, () => {
  it('прод: «страница не загрузилась» в head и проверка import maps в bodyClose, у каждого свой ключ дедупа', async () => {
    expect(await headScripts({ dev: false })).toEqual([DEAD_LOAD, IMPORTMAP_CHECK])
  })

  it('dev: скриптов нет', async () => {
    expect(await headScripts({ dev: true })).toEqual([])
  })

  it('прод: скрипты приложения сохраняются, скрипты модуля добавляются после них', async () => {
    const scripts = await headScripts({ dev: false, userScripts: [{ src: '/analytics.js' }] })
    expect(scripts).toEqual([{ src: '/analytics.js' }, DEAD_LOAD, IMPORTMAP_CHECK])
  })
})
