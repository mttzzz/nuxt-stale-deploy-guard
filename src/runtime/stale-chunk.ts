/*
 * Регекс-паттерны для известных stale-chunk ошибок (async-component / dynamic-import,
 * упавшие из-за того, что чанк удалён после деплоя). Шарятся между chunk-reload guard'ом
 * и Sentry-фильтром (sub-export `/sentry`).
 */

export const STALE_CHUNK_PATTERNS: readonly RegExp[] = [
  /Couldn't resolve component/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i,
] as const

export function isStaleChunkMessage(message: string): boolean {
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message))
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
