import { isStaleChunkError } from './stale-chunk'

/*
 * Чистая логика «verify-before-reload» для защиты от infinite reload'ов при
 * chunk-ошибках после деплоя. Используется в `runtime/plugin.client.ts`. Вынесена
 * в отдельный модуль, чтобы тестировать без Nuxt runtime.
 *
 * Semantics:
 *   - `verifyAndReload(path, error)` — реактивный вердикт для СЛОМАННОЙ вкладки (stale-chunk ошибка):
 *     фетчит server buildId пробами и релоадит, если ХОТЬ ОДНА проба увидела чужой id. Защищает
 *     от бесконечного reload'а при НЕ-deploy поломках чанка (build-bug, CDN-промах, сетевой хиккап).
 *     Ошибку вкладки guard ПРОГЛАТЫВАЕТ (preventDefault в плагине), поэтому каждый исход
 *     «перезагрузки не будет» обязан дойти до слушателя события `app:chunk-reload-blocked` через
 *     `deps.dispatchBlocked` (причины и поля — `ChunkReloadBlockedDetail`). Иначе вкладка остаётся
 *     мёртвой, а в Sentry тишина: ignoreErrors режет сами stale-chunk ошибки (прод-инцидент
 *     ai.pushka.biz 15.10.2026: iOS 16.0.2 без import maps → 4 пробы, build-id совпал → ничего).
 *     Молча пропускается только вызов, упёршийся в `verifyInFlight`: свой исход отправит идущая
 *     верификация.
 *   - `verifyConvergedAndReload(path)` — проактивный вердикт для РАБОТАЮЩЕЙ вкладки (опциональный
 *     poll): релоадит только когда ВСЕ пробы единогласно увидели один и тот же чужой id — флот
 *     сошёлся на новом билде. Вердикт «хоть одна проба» здесь ложный: в окне rolling-деплоя вкладка
 *     на НОВОМ билде видит старый под, перезагружается и приезжает на старый билд — цикл до
 *     circuit breaker'а (ai.pushka.biz 09.09.2026, replicas=2, maxSurge=1). Ошибку он не глотает
 *     (вкладка работает), поэтому событий НЕ шлёт ни при каком исходе, включая circuit breaker.
 *   - `handleStaleChunkError(err, path)` — фильтрует известные stale-chunk паттерны
 *     и триггерит verifyAndReload, передавая исходную ошибку.
 *   - Cooldown (10s) + verifyInFlight защищают от параллельных вызовов/race'ов. Cooldown, начатый ЭТОЙ
 *     страницей, событий не шлёт: reload уже вызван, вкладка доживает до выгрузки (навигация не мгновенна),
 *     и хвостовые ошибки чанков в этом окне — ещё старая страница. Иначе каждая устаревшая вкладка на
 *     каждом деплое слала бы «чанк упал сразу после перезагрузки». Cooldown в sessionStorage переживает
 *     reload, флаг в памяти — нет: на новой странице повторный сбой сообщается как `cooldown`.
 *   - Circuit breaker (3 reload'а в окне 5 мин) предотвращает бесконечный flash;
 *     на 4-й попытке реактивный вердикт дёргает `dispatchBlocked`, чтобы слушатель
 *     (error-boundary, Sentry) узнал, что вкладка осталась без reload'а.
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

/* Detail события `app:chunk-reload-blocked` — объединение по `reason`. Событие значит: guard проглотил
 * (или не стал обрабатывать) сбой загрузки чанка/скрипта, и перезагрузки НЕ будет. Контракт в одном месте:
 * причину `unsupported-browser` шлёт не guard, а inline-скрипт (`importmap-check.ts`) до старта приложения,
 * остальные — реактивная верификация ниже.
 *
 * `error` — исходная ошибка/значение, запустившее верификацию (payload `vite:preloadError`, `reason`
 * `unhandledrejection`, `error ?? message` события `error`, ошибка `vue:error`/`app:error`, `error` из хука
 * `app:chunkError`). Ключ есть всегда, значение может быть `undefined`. `probes` — build-id каждой пробы
 * (пустая строка — проба упала или ответила без заголовка). */

/** Реактивная верификация: ни одна проба не увидела чужой build-id — чанк сломан не деплоем. */
export interface NotStaleBlockedDetail {
  reason: 'not-stale'
  error: unknown
  probes: string[]
  buildId: string
}

/** Реактивная верификация хотела reload, circuit breaker запретил. */
export interface CircuitBreakerBlockedDetail {
  reason: 'circuit-breaker'
  error: unknown
  probes: string[]
  buildId: string
  attempts: number
  windowMs: number
}

/** Реактивная верификация пропущена: идёт cooldown после reload, а чанк упал уже на НОВОЙ странице
 *  (cooldown пережил reload в sessionStorage). На странице, которая сама вызвала reload, — тишина. */
export interface CooldownBlockedDetail {
  reason: 'cooldown'
  error: unknown
  buildId: string
}

/** Реактивная верификация пропущена: у клиента нет build-id. */
export interface NoBuildIdBlockedDetail {
  reason: 'no-build-id'
  error: unknown
}

/** Inline-скрипт (bodyClose, сразу после `window.stop()`): браузер без import maps, приложение не стартует. */
export interface UnsupportedBrowserBlockedDetail {
  reason: 'unsupported-browser'
  missing: 'importmap'
}

/** Исходы реактивной верификации — то, что `createChunkReloadGuard` шлёт через `deps.dispatchBlocked`. */
export type ChunkReloadBlockedDetail =
  | NotStaleBlockedDetail
  | CircuitBreakerBlockedDetail
  | CooldownBlockedDetail
  | NoBuildIdBlockedDetail

/** Полный detail события `app:chunk-reload-blocked` на window: исходы guard + inline-скрипт. */
export type ChunkReloadBlockedEventDetail = ChunkReloadBlockedDetail | UnsupportedBrowserBlockedDetail

/* Поля исхода без `error`: ошибку добавляет реактивная обёртка, у poll-вердикта её нет. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type ReportBlocked = (fields: DistributiveOmit<ChunkReloadBlockedDetail, 'error'>) => void

export interface ChunkReloadDeps {
  getBuildId: () => string
  reload: () => void
  fetchServerBuildId: (path: string, attempt?: number) => Promise<string>
  now: () => number
  /* Пауза между пробами; инъектится в тестах. По умолчанию — реальный setTimeout. */
  sleep?: (ms: number) => Promise<void>
  storage: Pick<Storage, 'getItem' | 'setItem'>
  /* Исход «reload не случится» реактивной верификации; poll не вызывает (см. шапку файла). */
  dispatchBlocked: (detail: ChunkReloadBlockedDetail) => void
}

export interface ChunkReloadGuard {
  verifyAndReload: (path?: string, error?: unknown) => Promise<void>
  verifyConvergedAndReload: (path?: string) => Promise<void>
  handleStaleChunkError: (err: unknown, path?: string) => void
}

function defaultSleep(ms: number): Promise<void> {
  // oxlint-disable-next-line promise/avoid-new -- Promise.withResolvers (ES2024) нет в iOS < 17.4 (Sentry kp-modmb-com-16), другого способа обернуть setTimeout нет
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

export function createChunkReloadGuard(deps: ChunkReloadDeps): ChunkReloadGuard {
  let verifyInFlight = false
  /* Reload вызван этой страницей: до выгрузки её cooldown — не повод для `cooldown` (см. шапку файла). */
  let reloadRequested = false

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

  /* Общий каркас обоих вердиктов: пустой buildId, cooldown, single-flight, circuit breaker.
     `reportBlocked` — только у реактивного вердикта: каждый исход «reload не случится» сообщается
     наружу; `verifyInFlight`-пропуск не сообщается (свой исход отправит идущая верификация). */
  async function verify(
    path: string,
    decide: (probes: string[], currentBuildId: string) => boolean,
    stopOnMismatch: boolean,
    reportBlocked?: ReportBlocked,
  ): Promise<void> {
    const currentBuildId = deps.getBuildId()
    if (!currentBuildId) {
      reportBlocked?.({ reason: 'no-build-id' })
      return
    }
    if (inCooldown()) {
      if (!reloadRequested) {
        reportBlocked?.({ reason: 'cooldown', buildId: currentBuildId })
      }
      return
    }
    if (verifyInFlight) {
      return
    }

    verifyInFlight = true
    try {
      const probes = await collectProbes(path, stopOnMismatch, currentBuildId)
      if (!decide(probes, currentBuildId)) {
        reportBlocked?.({ reason: 'not-stale', probes, buildId: currentBuildId })
        return
      }

      const attempts = recordAttemptAndCount()
      if (attempts > CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS) {
        reportBlocked?.({
          reason: 'circuit-breaker',
          probes,
          buildId: currentBuildId,
          attempts,
          windowMs: CHUNK_RELOAD_CIRCUIT_WINDOW_MS,
        })
        return
      }

      markReloadNow()
      reloadRequested = true
      deps.reload()
    } finally {
      verifyInFlight = false
    }
  }

  function verifyAndReload(path: string, error: unknown): Promise<void> {
    return verify(
      path,
      (probes, currentBuildId) => probes.some((id) => id !== '' && id !== currentBuildId),
      true,
      (fields) => {
        deps.dispatchBlocked({ ...fields, error })
      },
    )
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
      void verifyAndReload(path, err)
    }
  }

  return {
    verifyAndReload: (path?: string, error?: unknown) => verifyAndReload(path ?? '', error),
    verifyConvergedAndReload: (path?: string) => verifyConvergedAndReload(path ?? ''),
    handleStaleChunkError: (err: unknown, path?: string) => {
      handleStaleChunkError(err, path ?? '')
    },
  }
}
