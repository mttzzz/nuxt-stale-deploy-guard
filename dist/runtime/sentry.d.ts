export { DEPLOY_NOISE_PATTERNS, isDeployNoiseMessage, isStaleChunkError, isStaleChunkMessage, STALE_CHUNK_PATTERNS, } from './stale-chunk.js';
export interface SentryBreadcrumbLike {
    timestamp?: number;
    category?: string;
    level?: string;
    message?: string;
    data?: {
        arguments?: unknown[];
        [key: string]: unknown;
    };
}
export interface SentryEventLike {
    timestamp?: number;
    breadcrumbs?: SentryBreadcrumbLike[];
}
export declare function hasRecentStaleChunkBreadcrumb(event: SentryEventLike, opts?: {
    now?: number;
    windowMs?: number;
}): boolean;
/**
 * Возвращает функцию для `Sentry.init({ beforeSend })`. Дропает event'ы, где
 * за последние `windowMs` мс был console.error-breadcrumb со stale-chunk или
 * deploy-noise (manifest-poll) сообщением.
 */
export declare function createSentryStaleChunkFilter(opts?: {
    windowMs?: number;
}): <T extends SentryEventLike>(event: T) => T | null;
