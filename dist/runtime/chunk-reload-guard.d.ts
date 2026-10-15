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
/** Реактивная верификация пропущена: идёт cooldown после reload (чанк упал сразу после перезагрузки). */
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
/** Inline-скрипт (bodyClose, до `window.stop()`): браузер без import maps, приложение не стартует. */
export interface UnsupportedBrowserBlockedDetail {
    reason: 'unsupported-browser';
    missing: 'importmap';
}
/** Исходы реактивной верификации — то, что `createChunkReloadGuard` шлёт через `deps.dispatchBlocked`. */
export type ChunkReloadBlockedDetail = NotStaleBlockedDetail | CircuitBreakerBlockedDetail | CooldownBlockedDetail | NoBuildIdBlockedDetail;
/** Полный detail события `app:chunk-reload-blocked` на window: исходы guard + inline-скрипт. */
export type ChunkReloadBlockedEventDetail = ChunkReloadBlockedDetail | UnsupportedBrowserBlockedDetail;
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
