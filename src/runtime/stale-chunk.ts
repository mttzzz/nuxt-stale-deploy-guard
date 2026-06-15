/*
 * Регекс-паттерны для известных stale-chunk ошибок (async-component / dynamic-import,
 * упавшие из-за того, что чанк удалён после деплоя). Шарятся между chunk-reload guard'ом
 * и Sentry-фильтром (sub-export `/sentry`).
 */

export const STALE_CHUNK_PATTERNS: readonly RegExp[] = [
  /Couldn't resolve component/iu,
  /Failed to fetch dynamically imported module/iu,
  /error loading dynamically imported module/iu,
  /Importing a module script failed/iu,
] as const

export function isStaleChunkMessage(message: string): boolean {
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message))
}

/*
 * Deploy-transient ошибки, которые НЕ являются stale-chunk'ом (не триггерят reload),
 * но шумят в Sentry в окне деплоя. Дропаются только Sentry-фильтром (sub-export `/sentry`),
 * НЕ участвуют в `isStaleChunkError` → `verifyAndReload`.
 *
 * `Error fetching app manifest`: при `experimental.checkOutdatedBuildInterval` Nuxt
 * периодически пингует build-манифест (`/_nuxt/builds/...json`). Во время деплоя
 * (рестарт сервера) или при сетевом блипе `$fetch` падает «TypeError: Failed to fetch»,
 * Nuxt логирует «[nuxt] Error fetching app manifest.» и reject всплывает как
 * onunhandledrejection → Sentry (handled:no). Поллер сам ретраит — это не баг кода,
 * перезагружать страницу на него не нужно.
 */
export const DEPLOY_NOISE_PATTERNS: readonly RegExp[] = [/Error fetching app manifest/iu] as const

export function isDeployNoiseMessage(message: string): boolean {
  return DEPLOY_NOISE_PATTERNS.some((pattern) => pattern.test(message))
}

function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message
  }
  if (typeof err === 'string') {
    return err
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const { message } = err as { message?: unknown }
    if (typeof message === 'string') {
      return message
    }
  }
  return ''
}

export function isStaleChunkError(err: unknown): boolean {
  return isStaleChunkMessage(extractErrorMessage(err))
}
