import { describe, it, expect } from 'vitest'

import {
  createSentryStaleChunkFilter,
  hasRecentStaleChunkBreadcrumb,
  STALE_CHUNK_PATTERNS,
  type SentryEventLike,
} from '../../src/runtime/sentry'

const NOW_S = 1_700_000_000

function ev(opts: {
  ts?: number
  crumbs?: { ts?: number, category?: string, level?: string, message?: string, args?: unknown[] }[]
}): SentryEventLike {
  return {
    timestamp: opts.ts ?? NOW_S,
    breadcrumbs: opts.crumbs?.map(c => ({
      timestamp: c.ts,
      category: c.category,
      level: c.level,
      message: c.message,
      data: c.args ? { arguments: c.args } : undefined,
    })),
  }
}

describe('sentry exports', () => {
  it('STALE_CHUNK_PATTERNS re-exported and non-empty', () => {
    expect(STALE_CHUNK_PATTERNS.length).toBeGreaterThan(0)
  })
})

describe('hasRecentStaleChunkBreadcrumb', () => {
  it('match in window via message → true', () => {
    expect(
      hasRecentStaleChunkBreadcrumb(
        ev({
          crumbs: [
            {
              ts: NOW_S - 2,
              category: 'console',
              level: 'error',
              message: 'Failed to fetch dynamically imported module',
            },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('match outside window (>5s) → false', () => {
    expect(
      hasRecentStaleChunkBreadcrumb(
        ev({
          crumbs: [
            {
              ts: NOW_S - 10,
              category: 'console',
              level: 'error',
              message: 'Failed to fetch dynamically imported module',
            },
          ],
        }),
      ),
    ).toBe(false)
  })

  it('different category → false', () => {
    expect(
      hasRecentStaleChunkBreadcrumb(
        ev({
          crumbs: [
            { ts: NOW_S - 1, category: 'http', level: 'error', message: 'Failed to fetch dynamically imported module' },
          ],
        }),
      ),
    ).toBe(false)
  })

  it('different level → false', () => {
    expect(
      hasRecentStaleChunkBreadcrumb(
        ev({
          crumbs: [
            {
              ts: NOW_S - 1,
              category: 'console',
              level: 'warning',
              message: 'Failed to fetch dynamically imported module',
            },
          ],
        }),
      ),
    ).toBe(false)
  })

  it('match via data.arguments (Error object) → true', () => {
    expect(
      hasRecentStaleChunkBreadcrumb(
        ev({
          crumbs: [
            {
              ts: NOW_S - 1,
              category: 'console',
              level: 'error',
              args: [new Error('Couldn\'t resolve component Foo')],
            },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('match via data.arguments (string) → true', () => {
    expect(
      hasRecentStaleChunkBreadcrumb(
        ev({
          crumbs: [
            {
              ts: NOW_S - 1,
              category: 'console',
              level: 'error',
              args: ['Importing a module script failed.'],
            },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('no breadcrumbs → false', () => {
    expect(hasRecentStaleChunkBreadcrumb(ev({}))).toBe(false)
  })
})

describe('deploy-noise: Nuxt app-manifest fetch error', () => {
  /*
   * Прод-инцидент AI-PUSHKA-BIZ-1M: при `experimental.checkOutdatedBuildInterval`
   * Nuxt каждые N секунд пингует build-манифест (`/_nuxt/builds/...`). В окне деплоя
   * (рестарт сервера) или при сетевом блипе `$fetch` падает с "TypeError: Failed to fetch",
   * Nuxt логирует "[nuxt] Error fetching app manifest." и reject всплывает как
   * onunhandledrejection → Sentry (handled:no). Это транзиентный deploy-шум, не баг кода —
   * фильтр должен его дропать, как и stale-chunk ошибки.
   */
  const MANIFEST_MSG = '[nuxt] Error fetching app manifest.'

  it('match via message → true', () => {
    expect(
      hasRecentStaleChunkBreadcrumb(
        ev({
          crumbs: [
            { ts: NOW_S - 1, category: 'console', level: 'error', message: `${MANIFEST_MSG} TypeError: Failed to fetch` },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('match via data.arguments (real Sentry console-breadcrumb shape) → true', () => {
    expect(
      hasRecentStaleChunkBreadcrumb(
        ev({
          crumbs: [
            {
              ts: NOW_S - 1,
              category: 'console',
              level: 'error',
              args: [MANIFEST_MSG, { message: 'Failed to fetch', name: 'TypeError' }],
            },
          ],
        }),
      ),
    ).toBe(true)
  })

  it('createSentryStaleChunkFilter drops the event', () => {
    const filter = createSentryStaleChunkFilter()
    const e = ev({
      crumbs: [{ ts: NOW_S - 1, category: 'console', level: 'error', message: `${MANIFEST_MSG} TypeError: Failed to fetch` }],
    })
    expect(filter(e)).toBeNull()
  })
})

describe('createSentryStaleChunkFilter', () => {
  it('returns null for event with recent stale-chunk crumb', () => {
    const filter = createSentryStaleChunkFilter()
    const e = ev({
      crumbs: [
        { ts: NOW_S - 1, category: 'console', level: 'error', message: 'Failed to fetch dynamically imported module' },
      ],
    })
    expect(filter(e)).toBeNull()
  })

  it('returns event unchanged for unrelated event', () => {
    const filter = createSentryStaleChunkFilter()
    const e = ev({ crumbs: [{ ts: NOW_S - 1, category: 'console', level: 'error', message: 'Other error' }] })
    expect(filter(e)).toBe(e)
  })

  it('respects custom windowMs', () => {
    const filter = createSentryStaleChunkFilter({ windowMs: 1_000 })
    const e = ev({
      crumbs: [
        { ts: NOW_S - 3, category: 'console', level: 'error', message: 'Failed to fetch dynamically imported module' },
      ],
    })
    /* 3 seconds ago > 1s window → не дроп */
    expect(filter(e)).toBe(e)
  })
})
