export interface ModuleOptions {
    /** Имя header'а с build-id. Default: 'x-app-build-id'. */
    buildIdHeader?: string;
    /** Пути с no-cache,must-revalidate (HTML). Default: ['/**']. */
    htmlPaths?: string[];
    /** Пути с public,immutable cache. Default: ['/_nuxt/**']. */
    immutablePaths?: string[];
    /** Пути с no-store (API). Default: ['/api/**']. */
    apiPaths?: string[];
    /** Путь service worker. Default: '/service-worker.js'. */
    serviceWorkerPath?: string;
    /** Passive poll интервал (мс), 0 = выключить. Default: 60_000. */
    pollIntervalMs?: number;
    /** Cooldown между verify (мс). Default: 10_000. */
    cooldownMs?: number;
    /** Circuit breaker. Default: { maxAttempts: 3, windowMs: 300_000 }. */
    circuitBreaker?: {
        maxAttempts: number;
        windowMs: number;
    };
}
export interface ResolvedModuleOptions {
    buildIdHeader: string;
    htmlPaths: string[];
    immutablePaths: string[];
    apiPaths: string[];
    serviceWorkerPath: string;
    pollIntervalMs: number;
    cooldownMs: number;
    circuitBreaker: {
        maxAttempts: number;
        windowMs: number;
    };
}
