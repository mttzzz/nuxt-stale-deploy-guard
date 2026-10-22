export declare const CHUNK_RELOAD_COOLDOWN_KEY = "chunk-reload:last-reload-at";
export declare const CHUNK_RELOAD_ATTEMPTS_KEY = "chunk-reload:attempts";
export declare const CHUNK_RELOAD_COOLDOWN_MS = 10000;
export declare const CHUNK_RELOAD_CIRCUIT_WINDOW_MS: number;
export declare const CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS = 3;
export declare const CHUNK_RELOAD_PROBES = 4;
export declare const CHUNK_RELOAD_PROBE_DELAY_MS = 400;
/** Реактивная верификация: ни одна проба не увидела чужой build-id — чанк сломан не деплоем. */
export interface NotStaleBlockedDetail {
    reason: 'not-stale';
    error: unknown;
    probes: string[];
    buildId: string;
}
/** Реактивная верификация хотела reload, circuit breaker запретил. */
export interface CircuitBreakerBlockedDetail {
    reason: 'circuit-breaker';
    error: unknown;
    probes: string[];
    buildId: string;
    attempts: number;
    windowMs: number;
}
/** Реактивная верификация пропущена: идёт cooldown после reload, а чанк упал уже на НОВОЙ странице
 *  (cooldown пережил reload в sessionStorage). На странице, которая сама вызвала reload, — тишина. */
export interface CooldownBlockedDetail {
    reason: 'cooldown';
    error: unknown;
    buildId: string;
}
/** Реактивная верификация пропущена: у клиента нет build-id. */
export interface NoBuildIdBlockedDetail {
    reason: 'no-build-id';
    error: unknown;
}
/** Inline-скрипт (bodyClose, сразу после `window.stop()`): браузер без import maps, приложение не стартует. */
export interface UnsupportedBrowserBlockedDetail {
    reason: 'unsupported-browser';
    missing: 'importmap';
}
/** Что не загрузилось при `retry-failed`: чанк страницы (динамический импорт) или entry (`<script type="module">`). */
export type RetryFailedKind = 'chunk' | 'entry';
/** Inline-скрипт `dead-load.ts` (head): страница не загрузилась до `app:mounted` и после автоперезагрузки
 *  (в URL уже есть маркер `sdg-retry`) — показан экран «Страница не загрузилась». `error` — исходная
 *  ошибка/payload, если она есть (у сбоя entry её нет: событие `error` скрипта ошибки не несёт); `url` —
 *  адрес скрипта entry, который не загрузился. Приходит ровно один раз за загрузку страницы. */
export interface RetryFailedBlockedDetail {
    reason: 'retry-failed';
    kind: RetryFailedKind;
    error?: unknown;
    url?: string;
}
/** Исходы реактивной верификации — то, что `createChunkReloadGuard` шлёт через `deps.dispatchBlocked`. */
export type ChunkReloadBlockedDetail = NotStaleBlockedDetail | CircuitBreakerBlockedDetail | CooldownBlockedDetail | NoBuildIdBlockedDetail;
/** Полный detail события `app:chunk-reload-blocked` на window: исходы guard + inline-скрипты. */
export type ChunkReloadBlockedEventDetail = ChunkReloadBlockedDetail | UnsupportedBrowserBlockedDetail | RetryFailedBlockedDetail;
/** Имя события watchdog'а «приложение не загрузилось». */
export declare const LOAD_TIMEOUT_EVENT = "app:load-timeout";
/** Detail события `app:load-timeout` — приложение не смонтировалось за отведённое время.
 *
 *  Шлёт inline-скрипт `dead-load.ts` (head) — единственное место, где видно «приложение вообще не
 *  стартовало»: ни один обработчик сбоя не сработал, ошибок в консоли нет, а вкладка просто мёртвая.
 *  Отчёт уходит ОДИН раз за документ и только если приложение не смонтировалось и пользователю не был
 *  показан экран «страница не загрузилась» (для него есть своё событие `retry-failed`).
 *
 *  `timeoutMs` — сколько ждали (опция модуля `loadTimeoutMs`, дефолт 45_000); `elapsedMs` — сколько
 *  прошло на самом деле (таймеры в фоне вкладки могут сработать позже); `url` — адрес страницы;
 *  `kind` — что не загрузилось, если скрипт к тому времени уже видел сбой (`chunk` | `entry`), иначе
 *  поля нет: сбоя не было, приложение просто не стартовало. */
export interface LoadTimeoutDetail {
    reason: 'load-timeout';
    timeoutMs: number;
    elapsedMs: number;
    url: string;
    kind?: RetryFailedKind;
}
export interface ChunkReloadDeps {
    getBuildId: () => string;
    reload: () => void;
    fetchServerBuildId: (path: string, attempt?: number) => Promise<string>;
    now: () => number;
    sleep?: (ms: number) => Promise<void>;
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    dispatchBlocked: (detail: ChunkReloadBlockedDetail) => void;
}
export interface ChunkReloadGuard {
    verifyAndReload: (path?: string, error?: unknown) => Promise<void>;
    verifyConvergedAndReload: (path?: string) => Promise<void>;
    handleStaleChunkError: (err: unknown, path?: string) => void;
}
export declare function createChunkReloadGuard(deps: ChunkReloadDeps): ChunkReloadGuard;
