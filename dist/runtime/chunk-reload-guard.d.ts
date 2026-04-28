export declare const CHUNK_RELOAD_COOLDOWN_KEY = "chunk-reload:last-reload-at";
export declare const CHUNK_RELOAD_ATTEMPTS_KEY = "chunk-reload:attempts";
export declare const CHUNK_RELOAD_COOLDOWN_MS = 10000;
export declare const CHUNK_RELOAD_CIRCUIT_WINDOW_MS: number;
export declare const CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS = 3;
export interface ChunkReloadBlockedDetail {
    reason: 'circuit-breaker';
    attempts: number;
    windowMs: number;
}
export interface ChunkReloadDeps {
    getBuildId: () => string;
    reload: () => void;
    fetchServerBuildId: (path: string) => Promise<string>;
    now: () => number;
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    dispatchBlocked: (detail: ChunkReloadBlockedDetail) => void;
}
export interface ChunkReloadGuard {
    verifyAndReload: (path?: string) => Promise<void>;
    handleStaleChunkError: (err: unknown, path?: string) => void;
}
export declare function createChunkReloadGuard(deps: ChunkReloadDeps): ChunkReloadGuard;
