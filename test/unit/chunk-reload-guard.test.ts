import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CHUNK_RELOAD_ATTEMPTS_KEY,
  CHUNK_RELOAD_CIRCUIT_WINDOW_MS,
  CHUNK_RELOAD_COOLDOWN_MS,
  CHUNK_RELOAD_PROBES,
  type ChunkReloadBlockedDetail,
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
    clear: (): void => {
      store.clear()
    },
  }
}

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

interface GuardSetupOpts {
  buildId?: string
  serverId?: string | null
  fetchFails?: boolean
  emptyServerId?: boolean
}

function setup(opts: GuardSetupOpts = {}) {
  const { buildId = 'v1', serverId = 'v2', fetchFails = false, emptyServerId = false } = opts

  const reload = vi.fn<() => void>()
  const dispatchBlocked = vi.fn<(detail: ChunkReloadBlockedDetail) => void>()
  const storage = createFakeStorage()
  const nowSpy = vi.fn(() => Date.now())

  const fetchServerBuildId = vi.fn((): Promise<string> => {
    if (fetchFails) {
      return Promise.reject(new Error('network'))
    }
    if (emptyServerId) {
      return Promise.resolve('')
    }
    return Promise.resolve(serverId ?? '')
  })

  const guard = createChunkReloadGuard({
    getBuildId: () => buildId,
    reload,
    fetchServerBuildId,
    now: nowSpy,
    storage,
    dispatchBlocked,
    /* Мгновенный sleep: мульти-проба под fake timers иначе зависла бы на реальном setTimeout. */
    sleep: async () => {},
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

    it('server buildId совпадает → все пробы исчерпаны, reload() НЕ вызывается', async () => {
      const { guard, reload, fetchServerBuildId } = setup({ buildId: 'v1', serverId: 'v1' })
      await guard.verifyAndReload()
      await flushMicrotasks()
      /* Мульти-проба: совпадение одной пробы больше не вердикт (mixed-поды при rolling). */
      expect(fetchServerBuildId).toHaveBeenCalledTimes(CHUNK_RELOAD_PROBES)
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
      expect(fetchServerBuildId).toHaveBeenCalledWith('/dashboard/page?foo=bar', 0)
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

    it("Couldn't resolve component — verify + reload", async () => {
      const { guard, reload } = setup({ buildId: 'v1', serverId: 'v2' })
      guard.handleStaleChunkError(new Error("Couldn't resolve component Foo"))
      await flushMicrotasks()
      expect(reload).toHaveBeenCalledOnce()
    })

    it('null / undefined / пустая строка → ignore', async () => {
      const { guard, reload, fetchServerBuildId } = setup({ buildId: 'v1', serverId: 'v2' })
      guard.handleStaleChunkError(null)
      // oxlint-disable-next-line unicorn/no-useless-undefined -- undefined здесь обязательный аргумент-кейс
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
    it('3 параллельных verify → пробы только от ОДНОГО (verifyInFlight)', async () => {
      const { guard, fetchServerBuildId } = setup({ buildId: 'v1', serverId: 'v1' })
      await Promise.all([guard.verifyAndReload(), guard.verifyAndReload(), guard.verifyAndReload()])
      await flushMicrotasks()
      expect(fetchServerBuildId).toHaveBeenCalledTimes(CHUNK_RELOAD_PROBES)
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
          // oxlint-disable-next-line typescript/no-unsafe-assignment -- vitest expect.any() typed as any by design
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

describe('мульти-проба (mixed-pods при replicas>=2, инцидент ai.pushka.biz 29.07)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-04-23T00:00:00Z') })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /* Одна проба гонится с окном роллинга: HEAD может попасть в СТАРЫЙ под → build-id совпал →
     «деплоя нет» → приложение остаётся мёртвым (белая страница, hard refresh руками).
     Мульти-проба: reload, если ХОТЬ ОДНА из проб увидела чужой build-id. */
  it('первая проба видит свой buildId (старый под), вторая — новый → reload', async () => {
    const reload = vi.fn<() => void>()
    const answers = ['v1', 'v2']
    const fetchServerBuildId = vi.fn(() => Promise.resolve(answers.shift() ?? 'v2'))
    const guard = createChunkReloadGuard({
      getBuildId: () => 'v1',
      reload,
      fetchServerBuildId,
      now: () => Date.now(),
      storage: createFakeStorage(),
      dispatchBlocked: vi.fn<(detail: ChunkReloadBlockedDetail) => void>(),
      sleep: async () => {},
    })

    await guard.verifyAndReload()

    expect(fetchServerBuildId).toHaveBeenCalledTimes(2)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('все пробы совпали со своим buildId → все PROBE_COUNT проб исчерпаны, reload нет', async () => {
    const reload = vi.fn<() => void>()
    const fetchServerBuildId = vi.fn(() => Promise.resolve('v1'))
    const guard = createChunkReloadGuard({
      getBuildId: () => 'v1',
      reload,
      fetchServerBuildId,
      now: () => Date.now(),
      storage: createFakeStorage(),
      dispatchBlocked: vi.fn<(detail: ChunkReloadBlockedDetail) => void>(),
      sleep: async () => {},
    })

    await guard.verifyAndReload()

    expect(fetchServerBuildId).toHaveBeenCalledTimes(CHUNK_RELOAD_PROBES)
    expect(reload).not.toHaveBeenCalled()
  })

  it('пробы получают индекс попытки — плагин добавляет по нему cache-buster', async () => {
    const seen: unknown[] = []
    const fetchServerBuildId = vi.fn((_path: string, attempt?: number) => {
      seen.push(attempt)
      return Promise.resolve('v1')
    })
    const guard = createChunkReloadGuard({
      getBuildId: () => 'v1',
      reload: vi.fn<() => void>(),
      fetchServerBuildId,
      now: () => Date.now(),
      storage: createFakeStorage(),
      dispatchBlocked: vi.fn<(detail: ChunkReloadBlockedDetail) => void>(),
      sleep: async () => {},
    })

    await guard.verifyAndReload()

    expect(seen).toEqual([0, 1, 2, 3])
  })
})

/* Проактивный вердикт (poll) — для РАБОТАЮЩЕЙ вкладки. «Хоть одна проба» здесь ложный:
   в окне rolling-деплоя (ai.pushka.biz 09.09.2026, replicas=2, maxSurge=1) вкладка на НОВОМ
   билде видела старый под, перезагружалась и с вероятностью 2/3 приезжала на старый билд —
   цикл до circuit breaker'а. Reload только при схождении флота. */
describe('verifyConvergedAndReload — проактивный вердикт по схождению флота', () => {
  function setupConverged(answers: string[], buildId = 'v1') {
    const reload = vi.fn<() => void>()
    const queue = [...answers]
    const fetchServerBuildId = vi.fn(() => {
      const next = queue.shift()
      return next === undefined ? Promise.reject(new Error('probe overflow')) : Promise.resolve(next)
    })
    const guard = createChunkReloadGuard({
      getBuildId: () => buildId,
      reload,
      fetchServerBuildId,
      now: () => Date.now(),
      storage: createFakeStorage(),
      dispatchBlocked: vi.fn<(detail: ChunkReloadBlockedDetail) => void>(),
      sleep: async () => {},
    })
    return { guard, reload, fetchServerBuildId }
  }

  it('все пробы — один и тот же чужой id → reload', async () => {
    const { guard, reload, fetchServerBuildId } = setupConverged(['v2', 'v2', 'v2', 'v2'])
    await guard.verifyConvergedAndReload()
    expect(fetchServerBuildId).toHaveBeenCalledTimes(CHUNK_RELOAD_PROBES)
    expect(reload).toHaveBeenCalledOnce()
  })

  it('смешанные пробы (окно rolling: старый и новый под) → НЕТ reload', async () => {
    const { guard, reload, fetchServerBuildId } = setupConverged(['v2', 'v1', 'v2', 'v2'])
    await guard.verifyConvergedAndReload()
    /* Ранний выход по первому чужому id — реактивный режим; здесь пробы идут до конца. */
    expect(fetchServerBuildId).toHaveBeenCalledTimes(CHUNK_RELOAD_PROBES)
    expect(reload).not.toHaveBeenCalled()
  })

  it('все пробы — свой id → НЕТ reload', async () => {
    const { guard, reload } = setupConverged(['v1', 'v1', 'v1', 'v1'])
    await guard.verifyConvergedAndReload()
    expect(reload).not.toHaveBeenCalled()
  })

  it('одна проба упала/пустая при остальных чужих → НЕТ reload (схождение не доказано)', async () => {
    const { guard, reload } = setupConverged(['v2', '', 'v2', 'v2'])
    await guard.verifyConvergedAndReload()
    expect(reload).not.toHaveBeenCalled()
  })

  it('два разных чужих id (три билда в окне) → НЕТ reload', async () => {
    const { guard, reload } = setupConverged(['v2', 'v3', 'v2', 'v2'])
    await guard.verifyConvergedAndReload()
    expect(reload).not.toHaveBeenCalled()
  })

  it('cooldown после reload общий с реактивным вердиктом', async () => {
    const { guard, reload, fetchServerBuildId } = setupConverged(['v2', 'v2', 'v2', 'v2', 'v2'])
    await guard.verifyConvergedAndReload()
    expect(reload).toHaveBeenCalledOnce()
    await guard.verifyAndReload()
    expect(fetchServerBuildId).toHaveBeenCalledTimes(CHUNK_RELOAD_PROBES)
    expect(reload).toHaveBeenCalledOnce()
  })
})
