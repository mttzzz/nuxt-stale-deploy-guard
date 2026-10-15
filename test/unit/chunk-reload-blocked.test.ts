import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS,
  CHUNK_RELOAD_CIRCUIT_WINDOW_MS,
  CHUNK_RELOAD_COOLDOWN_MS,
  CHUNK_RELOAD_PROBES,
} from '../../src/runtime/chunk-reload-guard'
import { sentDetails, settle, setup, setupConverged } from './helpers/chunk-reload-guard'

/*
 * Событие `app:chunk-reload-blocked`: guard ГЛОТАЕТ ошибку вкладки (preventDefault в плагине), поэтому каждый
 * исход «перезагрузки не будет» обязан дойти до слушателя вместе с исходной ошибкой. Прод-инцидент
 * ai.pushka.biz 15.10.2026: build-id совпал на всех пробах → ничего → юзер на 500, в Sentry ноль.
 * Вердикты и reload — в chunk-reload-guard.test.ts; здесь — только что и с чем уходит слушателю.
 */

const COOLDOWN_MS = CHUNK_RELOAD_COOLDOWN_MS
const CIRCUIT_WINDOW_MS = CHUNK_RELOAD_CIRCUIT_WINDOW_MS

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-04-23T00:00:00Z') })
})
afterEach(() => {
  vi.useRealTimers()
})

describe('реактивная верификация — каждый исход «reload не случится» сообщается с исходной ошибкой', () => {
  const chunkError = new TypeError('Failed to fetch dynamically imported module: /_nuxt/invite.js')

  it('not-stale: ни одна проба не увидела чужой build-id → detail с ошибкой, пробами и buildId', async () => {
    const { guard, reload, dispatchBlocked } = setup({ buildId: 'v1', serverId: 'v1' })
    await guard.verifyAndReload('/invite/abc', chunkError)
    expect(reload).not.toHaveBeenCalled()
    expect(dispatchBlocked).toHaveBeenCalledExactlyOnceWith({
      reason: 'not-stale',
      error: chunkError,
      probes: Array.from({ length: CHUNK_RELOAD_PROBES }, () => 'v1'),
      buildId: 'v1',
    })
    /* Сравнение через toEqual идёт по содержимому ошибок — тождество объекта проверяем отдельно. */
    expect(sentDetails(dispatchBlocked)[0]?.error).toBe(chunkError)
  })

  it('not-stale: упавшие пробы (сеть) — тоже не доказательство; пустые id видны в probes', async () => {
    const { guard, reload, dispatchBlocked } = setup({ buildId: 'v1', fetchFails: true })
    await guard.verifyAndReload('/invite/abc', chunkError)
    expect(reload).not.toHaveBeenCalled()
    expect(dispatchBlocked).toHaveBeenCalledExactlyOnceWith({
      reason: 'not-stale',
      error: chunkError,
      probes: Array.from({ length: CHUNK_RELOAD_PROBES }, () => ''),
      buildId: 'v1',
    })
  })

  it('circuit-breaker: 4я попытка в окне → detail с пробами, attempts и windowMs', async () => {
    const { guard, reload, dispatchBlocked } = setup({ buildId: 'v1', serverId: 'v2' })
    for (let i = 0; i < CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS; i++) {
      await guard.verifyAndReload('', chunkError)
      vi.advanceTimersByTime(COOLDOWN_MS + 1)
    }
    expect(reload).toHaveBeenCalledTimes(CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS)
    expect(dispatchBlocked).not.toHaveBeenCalled()

    await guard.verifyAndReload('', chunkError)

    expect(reload).toHaveBeenCalledTimes(CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS)
    expect(dispatchBlocked).toHaveBeenCalledExactlyOnceWith({
      reason: 'circuit-breaker',
      error: chunkError,
      /* Реактивный режим останавливается на первой пробе с чужим id. */
      probes: ['v2'],
      buildId: 'v1',
      attempts: CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS + 1,
      windowMs: CIRCUIT_WINDOW_MS,
    })
  })

  it('cooldown: вкладка после reload (тот же sessionStorage) снова уронила чанк → detail с её ошибкой, пробы не идут', async () => {
    const before = setup({ buildId: 'v1', serverId: 'v2' })
    await before.guard.verifyAndReload('', chunkError)
    expect(before.reload).toHaveBeenCalledOnce()

    /* Новая страница — новый guard; cooldown пережил reload в общем sessionStorage. */
    const after = setup({ buildId: 'v2', serverId: 'v2', storage: before.storage })
    const afterReloadError = new Error("Couldn't resolve component default")
    await after.guard.verifyAndReload('', afterReloadError)

    expect(after.fetchServerBuildId).not.toHaveBeenCalled()
    expect(after.reload).not.toHaveBeenCalled()
    expect(after.dispatchBlocked).toHaveBeenCalledExactlyOnceWith({
      reason: 'cooldown',
      error: afterReloadError,
      buildId: 'v2',
    })
  })

  it('cooldown той же страницы, что вызвала reload (вкладка ещё не выгрузилась) → тишина: иначе событие на каждом деплое', async () => {
    const { guard, reload, dispatchBlocked, fetchServerBuildId } = setup({ buildId: 'v1', serverId: 'v2' })
    await guard.verifyAndReload('', chunkError)
    expect(reload).toHaveBeenCalledOnce()
    const probesBefore = fetchServerBuildId.mock.calls.length

    await guard.verifyAndReload('', new Error('хвостовая ошибка старой страницы до выгрузки'))

    expect(fetchServerBuildId).toHaveBeenCalledTimes(probesBefore)
    expect(reload).toHaveBeenCalledOnce()
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('no-build-id: у клиента нет build-id → detail только с ошибкой, пробы не идут', async () => {
    const { guard, reload, dispatchBlocked, fetchServerBuildId } = setup({ buildId: '', serverId: 'v2' })
    await guard.verifyAndReload('', chunkError)
    expect(fetchServerBuildId).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
    expect(dispatchBlocked).toHaveBeenCalledExactlyOnceWith({ reason: 'no-build-id', error: chunkError })
  })

  it('ошибка не передана → detail.error === undefined, остальные поля на месте', async () => {
    const { guard, dispatchBlocked } = setup({ buildId: 'v1', serverId: 'v1' })
    await guard.verifyAndReload()
    const [detail] = sentDetails(dispatchBlocked)
    expect(detail).toMatchObject({ reason: 'not-stale', buildId: 'v1' })
    expect(detail?.error).toBeUndefined()
  })

  it('verifyInFlight-пропуск — без события: свой исход отправит идущая верификация', async () => {
    const { guard, dispatchBlocked } = setup({ buildId: 'v1', serverId: 'v1' })
    await Promise.all([
      guard.verifyAndReload('', chunkError),
      guard.verifyAndReload('', new Error('вторая ошибка той же пачки')),
      guard.verifyAndReload('', new Error('третья ошибка той же пачки')),
    ])
    expect(dispatchBlocked).toHaveBeenCalledOnce()
    expect(sentDetails(dispatchBlocked)[0]?.error).toBe(chunkError)
  })

  it('reload-путь — без события: чужой build-id → reload, dispatchBlocked не вызывается', async () => {
    const { guard, reload, dispatchBlocked } = setup({ buildId: 'v1', serverId: 'v2' })
    await guard.verifyAndReload('', chunkError)
    expect(reload).toHaveBeenCalledOnce()
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('handleStaleChunkError передаёт в detail ту же ошибку, что получил', async () => {
    const { guard, dispatchBlocked } = setup({ buildId: 'v1', serverId: 'v1' })
    guard.handleStaleChunkError(chunkError)
    await settle()
    expect(dispatchBlocked).toHaveBeenCalledOnce()
    expect(sentDetails(dispatchBlocked)[0]?.error).toBe(chunkError)
  })

  it('не stale-chunk ошибка — guard её не трогает: ни проб, ни события (даже без build-id)', async () => {
    const { guard, dispatchBlocked, fetchServerBuildId } = setup({ buildId: '', serverId: 'v2' })
    guard.handleStaleChunkError(new TypeError('Cannot read properties of undefined'))
    await settle()
    expect(fetchServerBuildId).not.toHaveBeenCalled()
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })
})

/* Poll работает с РАБОТАЮЩЕЙ вкладкой и ошибки не глотает — сообщать нечего. Событие не шлётся ни при каком
   исходе, включая circuit breaker (в 0.4.0 он слал). */
describe('poll (verifyConvergedAndReload) молчит: app:chunk-reload-blocked не шлётся ни при каком исходе', () => {
  it('схождение не доказано (смешанные пробы) → тишина', async () => {
    const { guard, reload, dispatchBlocked } = setupConverged(['v2', 'v1', 'v2', 'v2'])
    await guard.verifyConvergedAndReload()
    expect(reload).not.toHaveBeenCalled()
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('все пробы — свой id → тишина', async () => {
    const { guard, dispatchBlocked } = setupConverged(['v1', 'v1', 'v1', 'v1'])
    await guard.verifyConvergedAndReload()
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('нет build-id → тишина', async () => {
    const { guard, fetchServerBuildId, dispatchBlocked } = setupConverged(['v2', 'v2', 'v2', 'v2'], '')
    await guard.verifyConvergedAndReload()
    expect(fetchServerBuildId).not.toHaveBeenCalled()
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('cooldown после reload → тишина', async () => {
    const { guard, reload, fetchServerBuildId, dispatchBlocked } = setupConverged(
      Array.from({ length: CHUNK_RELOAD_PROBES * 2 }, () => 'v2'),
    )
    await guard.verifyConvergedAndReload()
    await guard.verifyConvergedAndReload()
    expect(reload).toHaveBeenCalledOnce()
    expect(fetchServerBuildId).toHaveBeenCalledTimes(CHUNK_RELOAD_PROBES)
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('circuit breaker запретил reload → тоже тишина', async () => {
    const rounds = CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS + 1
    const { guard, reload, dispatchBlocked } = setupConverged(
      Array.from({ length: rounds * CHUNK_RELOAD_PROBES }, () => 'v2'),
    )
    for (let i = 0; i < rounds; i++) {
      await guard.verifyConvergedAndReload()
      vi.advanceTimersByTime(COOLDOWN_MS + 1)
    }
    expect(reload).toHaveBeenCalledTimes(CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS)
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('reload-путь → тишина', async () => {
    const { guard, reload, dispatchBlocked } = setupConverged(['v2', 'v2', 'v2', 'v2'])
    await guard.verifyConvergedAndReload()
    expect(reload).toHaveBeenCalledOnce()
    expect(dispatchBlocked).not.toHaveBeenCalled()
  })

  it('после poll-reload: та же страница молчит, следующая сообщает cooldown реактивной ошибки', async () => {
    const before = setupConverged(['v2', 'v2', 'v2', 'v2'])
    await before.guard.verifyConvergedAndReload()
    expect(before.reload).toHaveBeenCalledOnce()

    await before.guard.verifyAndReload('', new Error('хвостовая ошибка старой страницы до выгрузки'))
    expect(before.dispatchBlocked).not.toHaveBeenCalled()

    const after = setup({ buildId: 'v2', serverId: 'v2', storage: before.storage })
    const error = new Error("Couldn't resolve component default")
    await after.guard.verifyAndReload('', error)
    expect(after.dispatchBlocked).toHaveBeenCalledExactlyOnceWith({ reason: 'cooldown', error, buildId: 'v2' })
  })
})
