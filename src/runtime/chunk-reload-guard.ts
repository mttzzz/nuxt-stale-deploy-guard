import { isStaleChunkError } from './stale-chunk'

/*
 * Чистая логика «verify-before-reload» для защиты от infinite reload'ов при
 * chunk-ошибках после деплоя. Используется в `runtime/plugin.client.ts`. Вынесена
 * в отдельный модуль, чтобы тестировать без Nuxt runtime.
 *
 * Semantics:
 *   - `verifyAndReload(path)` — реактивный вердикт для СЛОМАННОЙ вкладки (stale-chunk ошибка):
 *     фетчит server buildId пробами и релоадит, если ХОТЬ ОДНА проба увидела чужой id. Защищает
 *     от бесконечного reload'а при НЕ-deploy поломках чанка (build-bug, CDN-промах, сетевой хиккап).
 *   - `verifyConvergedAndReload(path)` — проактивный вердикт для РАБОТАЮЩЕЙ вкладки (опциональный
 *     poll): релоадит только когда ВСЕ пробы единогласно увидели один и тот же чужой id — флот
 *     сошёлся на новом билде. Вердикт «хоть одна проба» здесь ложный: в окне rolling-деплоя вкладка
 *     на НОВОМ билде видит старый под, перезагружается и приезжает на старый билд — цикл до
 *     circuit breaker'а (ai.pushka.biz 09.09.2026, replicas=2, maxSurge=1).
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

/* Мульти-проба верификации (инцидент ai.pushka.biz 29.07, replicas>=2): в окне rolling-деплоя
 * единственная HEAD-проба 50/50 попадает в СТАРЫЙ под → build-id совпал → «деплоя нет» →
 * приложение остаётся мёртвым до ручного hard refresh. Пробуем несколько раз с паузой
 * (балансировщик раскидывает запросы по подам) и релоадим, если ХОТЬ ОДНА проба увидела
 * чужой build-id. Вероятность ложного «деплоя нет»: 50% → ~6% при 4 пробах. */
export const CHUNK_RELOAD_PROBES = 4
export const CHUNK_RELOAD_PROBE_DELAY_MS = 400

export interface ChunkReloadBlockedDetail {
  reason: 'circuit-breaker'
  attempts: number
  windowMs: number
}

export interface ChunkReloadDeps {
  getBuildId: () => string
  reload: () => void
  fetchServerBuildId: (path: string, attempt?: number) => Promise<string>
  now: () => number
  /* Пауза между пробами; инъектится в тестах. По умолчанию — реальный setTimeout. */
  sleep?: (ms: number) => Promise<void>
  storage: Pick<Storage, 'getItem' | 'setItem'>
  dispatchBlocked: (detail: ChunkReloadBlockedDetail) => void
}

export interface ChunkReloadGuard {
  verifyAndReload: (path?: string) => Promise<void>
  verifyConvergedAndReload: (path?: string) => Promise<void>
  handleStaleChunkError: (err: unknown, path?: string) => void
}

function defaultSleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
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

  /* Серия проб с паузой. `stopOnMismatch` — реактивный режим: первый чужой id решает, дальше не
     ходим. Иначе собираем все пробы для вердикта о схождении флота. Упавшая/пустая проба — ''. */
  async function collectProbes(path: string, stopOnMismatch: boolean, currentBuildId: string): Promise<string[]> {
    const sleep = deps.sleep ?? defaultSleep
    async function probe(attempt: number, seen: string[]): Promise<string[]> {
      let serverBuildId = ''
      try {
        serverBuildId = await deps.fetchServerBuildId(path, attempt)
      } catch {
        serverBuildId = ''
      }
      const collected = [...seen, serverBuildId]
      if (stopOnMismatch && serverBuildId && serverBuildId !== currentBuildId) {
        return collected
      }
      if (attempt + 1 >= CHUNK_RELOAD_PROBES) {
        return collected
      }
      await sleep(CHUNK_RELOAD_PROBE_DELAY_MS)
      return probe(attempt + 1, collected)
    }
    return probe(0, [])
  }

  /* Общий каркас обоих вердиктов: пустой buildId, cooldown, single-flight, circuit breaker. */
  async function verify(
    path: string,
    decide: (probes: string[], currentBuildId: string) => boolean,
    stopOnMismatch: boolean,
  ): Promise<void> {
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
      const probes = await collectProbes(path, stopOnMismatch, currentBuildId)
      if (!decide(probes, currentBuildId)) {
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

  function verifyAndReload(path = ''): Promise<void> {
    return verify(path, (probes, currentBuildId) => probes.some((id) => id !== '' && id !== currentBuildId), true)
  }

  function verifyConvergedAndReload(path = ''): Promise<void> {
    return verify(
      path,
      (probes, currentBuildId) => {
        const [first] = probes
        return Boolean(first) && first !== currentBuildId && probes.every((id) => id === first)
      },
      false,
    )
  }

  function handleStaleChunkError(err: unknown, path = ''): void {
    if (isStaleChunkError(err)) {
      void verifyAndReload(path)
    }
  }

  return {
    verifyAndReload: (path?: string) => verifyAndReload(path ?? ''),
    verifyConvergedAndReload: (path?: string) => verifyConvergedAndReload(path ?? ''),
    handleStaleChunkError: (err: unknown, path?: string) => {
      handleStaleChunkError(err, path ?? '')
    },
  }
}
