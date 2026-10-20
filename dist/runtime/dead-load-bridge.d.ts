import type { RetryFailedKind } from './chunk-reload-guard.js';
export declare const RETRY_MARKER_KEY = "sdg-retry";
export declare const DEAD_LOAD_GLOBAL = "__sdgDeadLoad";
export interface DeadLoadBridge {
    fail: (kind: RetryFailedKind, error?: unknown, url?: string) => void;
    mounted: () => void;
}
export declare function readDeadLoadBridge(): DeadLoadBridge | undefined;
