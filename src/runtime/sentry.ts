/*
 * Структурно-типизированные helpers для Sentry beforeSend / ignoreErrors. Без runtime-deps
 * на @sentry/*. Sub-export `/sentry`.
 *
 * Зачем: после stale-chunk ошибки (которая ловится через `STALE_CHUNK_PATTERNS` в
 * `Sentry.init({ ignoreErrors })`) в Sentry прилетают downstream-TypeError'ы из Vue
 * (например, "Cannot read properties of undefined (reading 'p')") при попытке отрендерить
 * unresolved async-компонент. Они не матчатся ignoreErrors и попадают в проект как
 * шум. Фильтр `createSentryStaleChunkFilter()` смотрит breadcrumbs события за последние
 * `windowMs` (5s по умолчанию) и дропает event если в этом окне есть console.error
 * со stale-chunk сообщением.
 */

import { isDeployNoiseMessage, isStaleChunkMessage } from './stale-chunk'

export {
  DEPLOY_NOISE_PATTERNS,
  isDeployNoiseMessage,
  isStaleChunkError,
  isStaleChunkMessage,
  STALE_CHUNK_PATTERNS,
} from './stale-chunk'

/* Drop-кандидаты Sentry-фильтра: stale-chunk (dynamic-import) ИЛИ deploy-noise
   (manifest-poll). Объединение шире, чем reload-триггер `isStaleChunkError`,
   который намеренно остаётся только на STALE_CHUNK_PATTERNS. */
function isDroppableBreadcrumbMessage(message: string): boolean {
  return isStaleChunkMessage(message) || isDeployNoiseMessage(message)
}

export interface SentryBreadcrumbLike {
  timestamp?: number
  category?: string
  level?: string
  message?: string
  data?: { arguments?: unknown[]; [key: string]: unknown }
}

export interface SentryEventLike {
  timestamp?: number
  breadcrumbs?: SentryBreadcrumbLike[]
}

const DEFAULT_BREADCRUMB_WINDOW_MS = 5_000

export function hasRecentStaleChunkBreadcrumb(
  event: SentryEventLike,
  opts: { now?: number; windowMs?: number } = {},
): boolean {
  const { breadcrumbs } = event
  if (!breadcrumbs || breadcrumbs.length === 0) {
    return false
  }
  const windowMs = opts.windowMs ?? DEFAULT_BREADCRUMB_WINDOW_MS
  const eventTimeMs = typeof event.timestamp === 'number' ? event.timestamp * 1000 : (opts.now ?? Date.now())
  return breadcrumbs.some((crumb) => crumbMatches(crumb, eventTimeMs, windowMs))
}

function crumbMatches(crumb: SentryBreadcrumbLike, eventTimeMs: number, windowMs: number): boolean {
  if (typeof crumb.timestamp !== 'number') {
    return false
  }
  const crumbTimeMs = crumb.timestamp * 1000
  const delta = eventTimeMs - crumbTimeMs
  if (delta < 0 || delta > windowMs) {
    return false
  }
  if (crumb.category !== 'console' || crumb.level !== 'error') {
    return false
  }
  if (crumb.message && isDroppableBreadcrumbMessage(crumb.message)) {
    return true
  }
  const args = crumb.data?.arguments
  if (!Array.isArray(args)) {
    return false
  }
  return args.some((arg) => {
    if (typeof arg === 'string') {
      return isDroppableBreadcrumbMessage(arg)
    }
    if (typeof arg === 'object' && arg !== null && 'message' in arg) {
      const { message } = arg as { message?: unknown }
      if (typeof message === 'string') {
        return isDroppableBreadcrumbMessage(message)
      }
    }
    return false
  })
}

/**
 * Возвращает функцию для `Sentry.init({ beforeSend })`. Дропает event'ы, где
 * за последние `windowMs` мс был console.error-breadcrumb со stale-chunk или
 * deploy-noise (manifest-poll) сообщением.
 */
export function createSentryStaleChunkFilter(
  opts: { windowMs?: number } = {},
): <T extends SentryEventLike>(event: T) => T | null {
  return <T extends SentryEventLike>(event: T): T | null => (hasRecentStaleChunkBreadcrumb(event, opts) ? null : event)
}
