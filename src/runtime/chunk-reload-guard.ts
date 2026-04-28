import { isStaleChunkError } from './stale-chunk'

/*
 * Чистая логика «verify-before-reload» для защиты от infinite reload'ов при
 * chunk-ошибках после деплоя. Используется в `runtime/plugin.client.ts`. Вынесена
 * в отдельный модуль, чтобы тестировать без Nuxt runtime.
 *
 * Semantics:
 *   - `verifyAndReload(path)` — фетчит server buildId, сравнивает с текущим,
 *     релоадит только при расхождении. Защищает от бесконечного reload'а при НЕ-deploy
 *     поломках чанка (build-bug, CDN-промах, сетевой хиккап).
 *   - `handleStaleChunkError(err, path)` — фильтрует известные stale-chunk паттерны
 *     и триггерит verifyAndReload.
 *   - Cooldown (10s) + verifyInFlight защищают от параллельных вызовов/race'ов.
 *   - Circuit breaker (3 reload'а в окне 5 мин) предотвращает бесконечный flash;
 *     на 4-й попытке дёргает `dispatchBlocked`, чтобы error-boundary мог показать
 *     юзеру нормальный экран.
 */

export const CHUNK_RELOAD_COOLDOWN_KEY = 'chunk-reload:last-reload-at'
export const CHUNK_RELOAD_ATTEMPTS_KEY = 'chunk-reload:attempts'
export const CHUNK_RELOAD_COOLDOWN_MS = 10_000
export const CHUNK_RELOAD_CIRCUIT_WINDOW_MS = 5 * 60 * 1000
export const CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS = 3

export interface ChunkReloadBlockedDetail {
  reason: 'circuit-breaker'
  attempts: number
  windowMs: number
}

export interface ChunkReloadDeps {
  getBuildId: () => string
  reload: () => void
  fetchServerBuildId: (path: string) => Promise<string>
  now: () => number
  storage: Pick<Storage, 'getItem' | 'setItem'>
  dispatchBlocked: (detail: ChunkReloadBlockedDetail) => void
}

export interface ChunkReloadGuard {
  verifyAndReload: (path?: string) => Promise<void>
  handleStaleChunkError: (err: unknown, path?: string) => void
}

export function createChunkReloadGuard(deps: ChunkReloadDeps): ChunkReloadGuard {
  let verifyInFlight = false

  function inCooldown(): boolean {
    const raw = deps.storage.getItem(CHUNK_RELOAD_COOLDOWN_KEY)
    const last = raw ? Number(raw) : 0
    return Number.isFinite(last) && deps.now() - last < CHUNK_RELOAD_COOLDOWN_MS
  }

  function markReloadNow(): void {
    deps.storage.setItem(CHUNK_RELOAD_COOLDOWN_KEY, String(deps.now()))
  }

  function recordAttemptAndCount(): number {
    const now = deps.now()
    const raw = deps.storage.getItem(CHUNK_RELOAD_ATTEMPTS_KEY)
    let existing: number[] = []
    if (raw) {
      try {
        const parsed: unknown = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          existing = parsed.filter((t): t is number => typeof t === 'number' && Number.isFinite(t))
        }
      } catch {
        existing = []
      }
    }
    const fresh = existing.filter((t) => now - t < CHUNK_RELOAD_CIRCUIT_WINDOW_MS)
    fresh.push(now)
    deps.storage.setItem(CHUNK_RELOAD_ATTEMPTS_KEY, JSON.stringify(fresh))
    return fresh.length
  }

  async function verifyAndReload(path = ''): Promise<void> {
    const currentBuildId = deps.getBuildId()
    if (!currentBuildId) {
      return
    }
    if (inCooldown()) {
      return
    }
    if (verifyInFlight) {
      return
    }

    verifyInFlight = true
    try {
      let serverBuildId = ''
      try {
        serverBuildId = await deps.fetchServerBuildId(path)
      } catch {
        serverBuildId = ''
      }
      if (!serverBuildId || serverBuildId === currentBuildId) {
        return
      }

      const attempts = recordAttemptAndCount()
      if (attempts > CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS) {
        deps.dispatchBlocked({
          reason: 'circuit-breaker',
          attempts,
          windowMs: CHUNK_RELOAD_CIRCUIT_WINDOW_MS,
        })
        return
      }

      markReloadNow()
      deps.reload()
    } finally {
      verifyInFlight = false
    }
  }

  function handleStaleChunkError(err: unknown, path = ''): void {
    if (isStaleChunkError(err)) {
      void verifyAndReload(path)
    }
  }

  return {
    verifyAndReload: (path?: string) => verifyAndReload(path ?? ''),
    handleStaleChunkError: (err: unknown, path?: string) => {
      handleStaleChunkError(err, path ?? '')
    },
  }
}
