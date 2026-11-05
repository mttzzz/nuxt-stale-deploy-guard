import { describe, expect, it } from 'vitest'

import {
  CHUNK_RELOAD_ATTEMPTS_KEY,
  CHUNK_RELOAD_CIRCUIT_WINDOW_MS,
  CHUNK_RELOAD_COOLDOWN_KEY,
} from '../../src/runtime/chunk-reload-guard'
import { createFakeStorage, sentDetails, setup } from './helpers/chunk-reload-guard'

/*
 * `handleFailedNavigation` — переход на маршрут упал на загрузке чанка (`router.onError`). Sentry AI-PUSHKA-BIZ-8Q
 * (ai.pushka.biz, 05.11.2026): VPN оборвал prefetch чанка, guard вынес `not-stale`, а Chromium ≤155 держит упавший
 * импорт в module map до конца жизни документа — переход по этой ссылке падал мгновенно, и клик ничего не делал до F5.
 * Вердикт по пробам такую вкладку не лечит, поэтому переход перезагружает её сразу на цель, под общими cooldown и
 * circuit breaker.
 */

const resolveError = new Error('Couldn\'t resolve component "default" at "/updates"')
const importError = new TypeError('Failed to fetch dynamically imported module: /_nuxt/updates.js')
const safariImportError = new TypeError('Importing a module script failed.')

describe('handleFailedNavigation — переход упал на чанке', () => {
  it.each([
    ["Couldn't resolve component (vite:preloadError погашен guard'ом)", resolveError],
    ['исходный TypeError импорта (чанк без Vite-хелпера)', importError],
    ['Safari: Importing a module script failed', safariImportError],
  ])('%s → reload сразу на цель: без проб и событий, даже при совпадающем build-id', (_name, error) => {
    const { guard, reload, fetchServerBuildId, dispatchBlocked, storage } = setup({ buildId: 'v1', serverId: 'v1' })

    guard.handleFailedNavigation(error, '/updates?tab=all#top')

    expect(reload).toHaveBeenCalledExactlyOnceWith('/updates?tab=all#top')
    expect(fetchServerBuildId).not.toHaveBeenCalled()
    expect(dispatchBlocked).not.toHaveBeenCalled()
    expect(storage.getItem(CHUNK_RELOAD_COOLDOWN_KEY)).not.toBeNull()
    expect(JSON.parse(storage.getItem(CHUNK_RELOAD_ATTEMPTS_KEY) ?? '[]')).toHaveLength(1)
  })

  it('переход упал не на чанке — guard его не трогает: ни reload, ни события, ни попытки в счётчике', () => {
    const { guard, reload, dispatchBlocked, storage } = setup()

    guard.handleFailedNavigation(new Error('middleware: доступ запрещён'), '/admin')

    expect(reload).not.toHaveBeenCalled()
    expect(dispatchBlocked).not.toHaveBeenCalled()
    expect(storage.getItem(CHUNK_RELOAD_ATTEMPTS_KEY)).toBeNull()
    expect(storage.getItem(CHUNK_RELOAD_COOLDOWN_KEY)).toBeNull()
  })

  it('вкладку только что перезагрузили (cooldown в sessionStorage) → событие cooldown с ошибкой, без reload', () => {
    const storage = createFakeStorage()
    storage.setItem(CHUNK_RELOAD_COOLDOWN_KEY, String(Date.now() - 1000))
    const { guard, reload, dispatchBlocked } = setup({ storage })

    guard.handleFailedNavigation(resolveError, '/updates')

    expect(reload).not.toHaveBeenCalled()
    expect(sentDetails(dispatchBlocked)).toEqual([{ reason: 'cooldown', error: resolveError, buildId: 'v1' }])
  })

  it('4-я перезагрузка в окне circuit breaker → событие circuit-breaker с пустыми probes, без reload', () => {
    const storage = createFakeStorage()
    const now = Date.now()
    storage.setItem(CHUNK_RELOAD_ATTEMPTS_KEY, JSON.stringify([now - 3000, now - 2000, now - 1000]))
    storage.setItem(CHUNK_RELOAD_COOLDOWN_KEY, String(now - 15_000))
    const { guard, reload, dispatchBlocked } = setup({ storage })

    guard.handleFailedNavigation(resolveError, '/updates')

    expect(reload).not.toHaveBeenCalled()
    expect(sentDetails(dispatchBlocked)).toEqual([
      {
        reason: 'circuit-breaker',
        error: resolveError,
        probes: [],
        buildId: 'v1',
        attempts: 4,
        windowMs: CHUNK_RELOAD_CIRCUIT_WINDOW_MS,
      },
    ])
  })

  it('один reload на страницу в окне cooldown: второй упавший переход до выгрузки молчит', () => {
    const { guard, reload, dispatchBlocked } = setup()

    guard.handleFailedNavigation(resolveError, '/updates')
    guard.handleFailedNavigation(resolveError, '/profile')

    expect(reload).toHaveBeenCalledExactlyOnceWith('/updates')
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('reload не состоялся (отменён beforeunload) — после cooldown упавший переход снова перезагружает', () => {
    const { guard, reload, dispatchBlocked, nowSpy } = setup()
    const start = Date.now()
    nowSpy.mockReturnValue(start)

    guard.handleFailedNavigation(resolveError, '/updates')
    nowSpy.mockReturnValue(start + 11_000)
    guard.handleFailedNavigation(resolveError, '/updates')

    expect(reload.mock.calls).toEqual([['/updates'], ['/updates']])
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })
})

describe('handleFailedNavigation и реактивная верификация того же сбоя', () => {
  it.each([
    ['build-id совпал (иначе ушёл бы not-stale)', 'v1'],
    ['build-id чужой (иначе был бы второй reload — на текущую страницу)', 'v2'],
  ])('переход упал, пока шли пробы: reload на цель, а вердикт серии уже не выносится — %s', async (_name, serverId) => {
    const { guard, reload, dispatchBlocked, fetchServerBuildId } = setup({ buildId: 'v1', serverId })

    /* Клик: упавший импорт снова роняет `vite:preloadError` — серия проб стартует, — а следом падает переход. */
    const verifying = guard.verifyAndReload('', importError)
    guard.handleFailedNavigation(resolveError, '/updates')
    await verifying

    expect(fetchServerBuildId).toHaveBeenCalled()
    expect(reload).toHaveBeenCalledExactlyOnceWith('/updates')
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('вкладка уже перезагружается по вердикту проб (чужой build-id) — упавший переход молчит', async () => {
    const { guard, reload, dispatchBlocked } = setup({ buildId: 'v1', serverId: 'v2' })

    await guard.verifyAndReload('', importError)
    guard.handleFailedNavigation(resolveError, '/updates')

    expect(reload, 'один reload — вердикта, на текущую страницу').toHaveBeenCalledExactlyOnceWith()
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })
})
