import { describe, expect, it } from 'vitest'

import { shouldEnableClientGuard } from '../../src/module'
import type { ResolvedModuleOptions } from '../../src/runtime/types'

/*
 * Юнит-проверка решения «подключать ли client guard» — extracted из module setup для прямой
 * проверки без полного nuxt-test-utils setup. Default skipInDev=true: в dev клиентский плагин
 * не подключается, иначе он ловит Vite HMR-503 как stale-chunk и force-reload'ит страницу.
 */

const BASE: ResolvedModuleOptions = {
  buildIdHeader: 'x-app-build-id',
  htmlPaths: ['/**'],
  immutablePaths: ['/_nuxt/**'],
  apiPaths: ['/api/**'],
  serviceWorkerPath: '/service-worker.js',
  pollIntervalMs: 60_000,
  cooldownMs: 10_000,
  circuitBreaker: { maxAttempts: 3, windowMs: 5 * 60_000 },
  skipInDev: true,
}

describe('shouldEnableClientGuard', () => {
  it('prod + skipInDev=true → true (guard активен в проде)', () => {
    expect(shouldEnableClientGuard({ ...BASE, skipInDev: true }, false)).toBe(true)
  })

  it('dev + skipInDev=true (default) → false (guard выключен в dev)', () => {
    expect(shouldEnableClientGuard({ ...BASE, skipInDev: true }, true)).toBe(false)
  })

  it('dev + skipInDev=false (override) → true (намеренное тестирование в dev)', () => {
    expect(shouldEnableClientGuard({ ...BASE, skipInDev: false }, true)).toBe(true)
  })

  it('prod + skipInDev=false → true', () => {
    expect(shouldEnableClientGuard({ ...BASE, skipInDev: false }, false)).toBe(true)
  })
})
