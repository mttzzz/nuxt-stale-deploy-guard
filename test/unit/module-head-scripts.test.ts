import { fileURLToPath } from 'node:url'

import { loadNuxt } from '@nuxt/kit'
import type { HTMLElement } from 'happy-dom'
import { describe, expect, it, vi } from 'vitest'

import { DEAD_LOAD_SCRIPT, DEAD_LOAD_SCRIPT_KEY, DEAD_LOAD_SCRIPT_PRIORITY } from '../../src/runtime/dead-load'
import { IMPORTMAP_CHECK_SCRIPT, IMPORTMAP_CHECK_SCRIPT_KEY } from '../../src/runtime/importmap-check'
import { closePages, createPage } from './helpers/dead-load-page'

/*
 * Как модуль кладёт inline-скрипты первой загрузки в `app.head.script` — на настоящем Nuxt (loadNuxt поднимает
 * конфиг и запускает setup модуля без сборки). Прод: «страница не загрузилась» в head (с числовым tagPriority —
 * слушатели обязаны стоять раньше entry) и проверка import maps в bodyClose; dev: ничего (в dev import map нет,
 * а экраны не должны реагировать на HMR). Опции проекта (палитра, тексты, таймаут watchdog'а) доезжают до
 * скрипта — и до экрана: скрипт исполняется в том же тексте, что уходит в HTML.
 */

const FIXTURE = fileURLToPath(new URL('../fixtures/default', import.meta.url))

const DEAD_LOAD = {
  key: DEAD_LOAD_SCRIPT_KEY,
  innerHTML: DEAD_LOAD_SCRIPT,
  tagPosition: 'head',
  tagPriority: DEAD_LOAD_SCRIPT_PRIORITY,
}
const IMPORTMAP_CHECK = { key: IMPORTMAP_CHECK_SCRIPT_KEY, innerHTML: IMPORTMAP_CHECK_SCRIPT, tagPosition: 'bodyClose' }

async function headScripts(options: {
  dev: boolean
  userScripts?: { src: string }[]
  guard?: Record<string, unknown>
}) {
  const nuxt = await loadNuxt({
    cwd: FIXTURE,
    dev: options.dev,
    overrides: {
      devtools: { enabled: false },
      telemetry: false,
      app: { head: { script: options.userScripts ?? [] } },
      staleDeployGuard: options.guard ?? {},
    },
  })
  try {
    return nuxt.options.app.head.script ?? []
  } finally {
    await nuxt.close()
  }
}

/* Текст inline-скрипта модуля по его ключу дедупа. */
async function scriptText(options: { dev: boolean; guard?: Record<string, unknown>; key: string }) {
  const scripts = await headScripts(options)
  const found = scripts.find((item) => 'key' in item && item.key === options.key)
  const innerHTML = found && 'innerHTML' in found ? found.innerHTML : undefined
  if (typeof innerHTML !== 'string') {
    throw new TypeError(`скрипт ${options.key} не найден`)
  }
  return innerHTML
}

const MODULE_RUNTIME = fileURLToPath(new URL('../../src/runtime/', import.meta.url))

/* Плагины рантайма модуля, которые его setup зарегистрировал (`addPlugin` кладёт их в `nuxt.options.plugins`):
   имя файла без расширения и режим. */
async function modulePlugins(options: { dev: boolean }) {
  const nuxt = await loadNuxt({
    cwd: FIXTURE,
    dev: options.dev,
    overrides: { devtools: { enabled: false }, telemetry: false },
  })
  try {
    return nuxt.options.plugins.flatMap((plugin) =>
      typeof plugin !== 'string' && plugin.src.startsWith(MODULE_RUNTIME)
        ? [{ file: plugin.src.slice(MODULE_RUNTIME.length).replace(/\.[cm]?[jt]s$/u, ''), mode: plugin.mode }]
        : [],
    )
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

describe('модуль — серверный плагин метки SSR', { timeout: 60_000 }, () => {
  it('прод: подключён серверным плагином (метку читает inline-скрипт, который есть только в проде)', async () => {
    expect(await modulePlugins({ dev: false })).toContainEqual({ file: 'plugin.server', mode: 'server' })
  })

  it('dev: плагинов модуля нет — inline-скриптов нет, метка некому читать', async () => {
    expect(await modulePlugins({ dev: true })).toEqual([])
  })
})

describe('модуль — опции проекта в inline-скриптах', { timeout: 60_000 }, () => {
  it('палитра и тексты проекта доезжают до экрана «страница не загрузилась»', async () => {
    const script = await scriptText({
      dev: false,
      key: DEAD_LOAD_SCRIPT_KEY,
      guard: {
        theme: { dark: { bg: '#0b1220', accent: '#24a4ff' } },
        texts: { failedTitle: 'Не открылось' },
      },
    })

    const page = createPage({ url: 'https://app.example.com/a?sdg-retry=chunk', script })
    page.run()
    page.preloadError(new Error('boom'))

    const root = page.document.querySelector<HTMLElement>('[data-sdg-dead-load]')
    const probe = page.document.createElement('div')
    probe.style.backgroundColor = '#0b1220'
    expect(root?.style.backgroundColor).toBe(probe.style.backgroundColor)
    expect(root?.querySelector('h1')?.textContent).toBe('Не открылось')
    await closePages()
  })

  it("порог watchdog'а из опций модуля доезжает до скрипта", async () => {
    const script = await scriptText({ dev: false, key: DEAD_LOAD_SCRIPT_KEY, guard: { loadTimeoutMs: 3000 } })

    vi.useFakeTimers()
    try {
      const page = createPage({ script })
      page.run()
      vi.advanceTimersByTime(2999)
      expect(page.timeouts).toEqual([])
      vi.advanceTimersByTime(1)
      expect(page.timeouts).toHaveLength(1)
      expect(page.timeouts[0]).toMatchObject({ timeoutMs: 3000, visibleMs: 3000 })
    } finally {
      vi.useRealTimers()
      await closePages()
    }
  })
})
