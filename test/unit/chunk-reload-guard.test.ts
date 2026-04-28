import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHUNK_RELOAD_ATTEMPTS_KEY,
  CHUNK_RELOAD_CIRCUIT_WINDOW_MS,
  CHUNK_RELOAD_COOLDOWN_MS,
  createChunkReloadGuard,
} from '../../src/runtime/chunk-reload-guard'

const COOLDOWN_MS = CHUNK_RELOAD_COOLDOWN_MS
const CIRCUIT_WINDOW_MS = CHUNK_RELOAD_CIRCUIT_WINDOW_MS

function createFakeStorage() {
  const store = new Map<string, string>()
  return {
    getItem: (k: string): string | null => store.get(k) ?? null,
    setItem: (k: string, v: string): void => {
      store.set(k, v)
    },
    clear: (): void => store.clear(),
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

type GuardSetupOpts = {
  buildId?: string
  serverId?: string | null
  fetchFails?: boolean
  emptyServerId?: boolean
}

function setup(opts: GuardSetupOpts = {}) {
  const { buildId = 'v1', serverId = 'v2', fetchFails = false, emptyServerId = false } = opts

  const reload = vi.fn()
  const dispatchBlocked = vi.fn()
  const storage = createFakeStorage()
  const nowSpy = vi.fn(() => Date.now())

  const fetchServerBuildId = vi.fn(async (): Promise<string> => {
    if (fetchFails) throw new Error('network')
    if (emptyServerId) return ''
    return serverId ?? ''
  })

  const guard = createChunkReloadGuard({
    getBuildId: () => buildId,
    reload,
    fetchServerBuildId,
    now: nowSpy,
    storage,
    dispatchBlocked,
  })

  return { guard, reload, dispatchBlocked, storage, fetchServerBuildId, nowSpy }
}

describe('createChunkReloadGuard', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-04-23T00:00:00Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('verifyAndReload — основной поток', () => {
    it('server buildId отличается → reload() вызывается', async () => {
      const { guard, reload } = setup({ buildId: 'v1', serverId: 'v2' })
      await guard.verifyAndReload()
      await flushMicrotasks()
      expect(reload).toHaveBeenCalledExactlyOnceWith()
    })

    it('server buildId совпадает → reload() НЕ вызывается', async () => {
      const { guard, reload, fetchServerBuildId } = setup({ buildId: 'v1', serverId: 'v1' })
      await guard.verifyAndReload()
      await flushMicrotasks()
      expect(fetchServerBuildId).toHaveBeenCalledOnce()
      expect(reload).not.toHaveBeenCalled()
    })

    it('fetch buildId падает → reload() НЕ вызывается', async () => {
      const { guard, reload } = setup({ buildId: 'v1', fetchFails: true })
      await guard.verifyAndReload()
      await flushMicrotasks()
      expect(reload).not.toHaveBeenCalled()
    })

    it('сервер вернул пустой id → reload() НЕ вызывается', async () => {
      const { guard, reload } = setup({ buildId: 'v1', emptyServerId: true })
      await guard.verifyAndReload()
      await flushMicrotasks()
      expect(reload).not.toHaveBeenCalled()
    })

    it('пустой currentBuildId → fetch не вызывается, reload не вызывается', async () => {
      const { guard, reload, fetchServerBuildId } = setup({ buildId: '', serverId: 'v2' })
      await guard.verifyAndReload()
      await flushMicrotasks()
      expect(fetchServerBuildId).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
    })

    it('path пробрасывается в fetchServerBuildId', async () => {
      const { guard, fetchServerBuildId } = setup({ buildId: 'v1', serverId: 'v1' })
      await guard.verifyAndReload('/dashboard/page?foo=bar')
      await flushMicrotasks()
      expect(fetchServerBuildId).toHaveBeenCalledWith('/dashboard/page?foo=bar')
    })
  })

  describe('handleStaleChunkError — routing от Vue/Nuxt hooks', () => {
    it('stale-chunk Error + mismatch → reload()', async () => {
      const { guard, reload } = setup({ buildId: 'v1', serverId: 'v2' })
      guard.handleStaleChunkError(new TypeError('Failed to fetch dynamically imported module: /_nuxt/x.js'))
      await flushMicrotasks()
      expect(reload).toHaveBeenCalledOnce()
    })

    it('произвольный TypeError → fetch не вызывается', async () => {
      const { guard, reload, fetchServerBuildId } = setup({ buildId: 'v1', serverId: 'v2' })
      guard.handleStaleChunkError(new TypeError('Cannot read properties of undefined'))
      await flushMicrotasks()
      expect(fetchServerBuildId).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
    })

    it('Couldn\'t resolve component — verify + reload', async () => {
      const { guard, reload } = setup({ buildId: 'v1', serverId: 'v2' })
      guard.handleStaleChunkError(new Error('Couldn\'t resolve component Foo'))
      await flushMicrotasks()
      expect(reload).toHaveBeenCalledOnce()
    })

    it('null / undefined / пустая строка → ignore', async () => {
      const { guard, reload, fetchServerBuildId } = setup({ buildId: 'v1', serverId: 'v2' })
      guard.handleStaleChunkError(null)
      guard.handleStaleChunkError(undefined)
      guard.handleStaleChunkError('')
      await flushMicrotasks()
      expect(fetchServerBuildId).not.toHaveBeenCalled()
      expect(reload).not.toHaveBeenCalled()
    })
  })

  describe('cooldown', () => {
    it('2 вызова подряд → 1 reload', async () => {
      const { guard, reload } = setup({ buildId: 'v1', serverId: 'v2' })
      await guard.verifyAndReload()
      await flushMicrotasks()
      await guard.verifyAndReload()
      await flushMicrotasks()
      expect(reload).toHaveBeenCalledOnce()
    })

    it('через >10s — следующий reload разрешён', async () => {
      const { guard, reload } = setup({ buildId: 'v1', serverId: 'v2' })
      await guard.verifyAndReload()
      await flushMicrotasks()
      vi.advanceTimersByTime(COOLDOWN_MS + 1)
      await guard.verifyAndReload()
      await flushMicrotasks()
      expect(reload).toHaveBeenCalledTimes(2)
    })
  })

  describe('verifyInFlight', () => {
    it('3 параллельных verify → 1 fetch', async () => {
      const { guard, fetchServerBuildId } = setup({ buildId: 'v1', serverId: 'v1' })
      await Promise.all([guard.verifyAndReload(), guard.verifyAndReload(), guard.verifyAndReload()])
      await flushMicrotasks()
      expect(fetchServerBuildId).toHaveBeenCalledOnce()
    })
  })

  describe('circuit breaker', () => {
    it('4я попытка в окне 5 мин → dispatchBlocked, reload не вызывается', async () => {
      const { guard, reload, dispatchBlocked } = setup({ buildId: 'v1', serverId: 'v2' })
      for (let i = 0; i < 3; i++) {
        await guard.verifyAndReload()
        await flushMicrotasks()
        vi.advanceTimersByTime(COOLDOWN_MS + 1)
      }
      expect(reload).toHaveBeenCalledTimes(3)

      await guard.verifyAndReload()
      await flushMicrotasks()

      expect(reload).toHaveBeenCalledTimes(3)
      expect(dispatchBlocked).toHaveBeenCalledOnce()
      expect(dispatchBlocked).toHaveBeenCalledWith(
        expect.objectContaining({
          reason: 'circuit-breaker',
          windowMs: CIRCUIT_WINDOW_MS,
          attempts: expect.any(Number),
        }),
      )
    })

    it('attempts старше 5 мин эвикаются', async () => {
      const { guard, reload, dispatchBlocked } = setup({ buildId: 'v1', serverId: 'v2' })
      for (let i = 0; i < 3; i++) {
        await guard.verifyAndReload()
        await flushMicrotasks()
        vi.advanceTimersByTime(COOLDOWN_MS + 1)
      }
      vi.advanceTimersByTime(CIRCUIT_WINDOW_MS + 1)
      await guard.verifyAndReload()
      await flushMicrotasks()
      expect(reload).toHaveBeenCalledTimes(4)
      expect(dispatchBlocked).not.toHaveBeenCalled()
    })

    it('corrupt JSON в storage → не падает, начинает с нуля', async () => {
      const { guard, reload, storage } = setup({ buildId: 'v1', serverId: 'v2' })
      storage.setItem(CHUNK_RELOAD_ATTEMPTS_KEY, '{not valid json')
      await guard.verifyAndReload()
      await flushMicrotasks()
      expect(reload).toHaveBeenCalledOnce()
    })
  })
})
