import type { RetryFailedKind } from './chunk-reload-guard.js';
export declare const RETRY_MARKER_KEY = "sdg-retry";
export declare const DEAD_LOAD_GLOBAL = "__sdgDeadLoad";
export declare const SSR_MARKER_ATTR = "data-sdg-ssr";
export interface DeadLoadBridge {
    fail: (kind: RetryFailedKind, error?: unknown, url?: string) => void;
    mounted: () => void;
    handled?: () => boolean;
}
export declare function readDeadLoadBridge(): DeadLoadBridge | undefined;
export declare function isDeadLoadHandled(bridge: DeadLoadBridge | undefined): boolean;
