import { type Mock, vi } from 'vitest'

import { type ChunkReloadBlockedDetail, createChunkReloadGuard } from '../../../src/runtime/chunk-reload-guard'

/* Общая оснастка unit-тестов guard'а (chunk-reload-guard.test.ts, chunk-reload-blocked.test.ts). */

export interface FakeStorage {
  getItem: (k: string) => string | null
  setItem: (k: string, v: string) => void
  clear: () => void
}

export function createFakeStorage(): FakeStorage {
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

export async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

/* Дать догореть асинхронной верификации, запущенной «в фоне» (`void guard.handle…`): серия проб — это
   десятки микротасков, а `flushMicrotasks` рассчитан на один быстрый вердикт. */
export async function settle() {
  for (let i = 0; i < 50; i++) {
    await Promise.resolve()
  }
}

/* Что реально ушло слушателю события `app:chunk-reload-blocked`, по порядку. */
export function sentDetails(
  dispatchBlocked: Mock<(detail: ChunkReloadBlockedDetail) => void>,
): ChunkReloadBlockedDetail[] {
  return dispatchBlocked.mock.calls.map(([detail]) => detail)
}

export interface GuardSetupOpts {
  buildId?: string
  serverId?: string | null
  fetchFails?: boolean
  emptyServerId?: boolean
  /* SessionStorage прошлой страницы: второй guard на нём — вкладка после reload. */
  storage?: FakeStorage
}

export function setup(opts: GuardSetupOpts = {}) {
  const { buildId = 'v1', serverId = 'v2', fetchFails = false, emptyServerId = false } = opts

  const reload = vi.fn<() => void>()
  const dispatchBlocked = vi.fn<(detail: ChunkReloadBlockedDetail) => void>()
  const storage = opts.storage ?? createFakeStorage()
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

/* Guard с очередью ответов проб (`answers` по порядку, дальше — упавшие пробы) — для вердикта по схождению флота. */
export function setupConverged(answers: string[], buildId = 'v1') {
  const reload = vi.fn<() => void>()
  const dispatchBlocked = vi.fn<(detail: ChunkReloadBlockedDetail) => void>()
  const queue = [...answers]
  const fetchServerBuildId = vi.fn(() => {
    const next = queue.shift()
    return next === undefined ? Promise.reject(new Error('probe overflow')) : Promise.resolve(next)
  })
  const storage = createFakeStorage()
  const guard = createChunkReloadGuard({
    getBuildId: () => buildId,
    reload,
    fetchServerBuildId,
    now: () => Date.now(),
    storage,
    dispatchBlocked,
    sleep: async () => {},
  })
  return { guard, reload, fetchServerBuildId, dispatchBlocked, storage }
}
