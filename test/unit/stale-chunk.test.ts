import { describe, it, expect } from 'vitest'

import {
  DEPLOY_NOISE_PATTERNS,
  isDeployNoiseMessage,
  isStaleChunkError,
  isStaleChunkMessage,
  STALE_CHUNK_PATTERNS,
} from '../../src/runtime/stale-chunk'

describe('STALE_CHUNK_PATTERNS', () => {
  it.each([
    'Failed to fetch dynamically imported module: /_nuxt/abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    "Couldn't resolve component Foo",
  ])('matches %j', (msg) => {
    expect(STALE_CHUNK_PATTERNS.some((re) => re.test(msg))).toBe(true)
  })

  it.each(['Cannot read properties of undefined', 'Network request failed', ''])('does not match %j', (msg) => {
    expect(STALE_CHUNK_PATTERNS.some((re) => re.test(msg))).toBe(false)
  })
})

describe('isStaleChunkMessage', () => {
  it('returns true for matching string', () => {
    expect(isStaleChunkMessage('Failed to fetch dynamically imported module')).toBe(true)
  })
  it('returns false for unrelated string', () => {
    expect(isStaleChunkMessage('Some other thing')).toBe(false)
  })
})

describe('DEPLOY_NOISE_PATTERNS / isDeployNoiseMessage', () => {
  it.each(['[nuxt] Error fetching app manifest. TypeError: Failed to fetch', 'Error fetching app manifest'])(
    'matches deploy-noise %j',
    (msg) => {
      expect(isDeployNoiseMessage(msg)).toBe(true)
      expect(DEPLOY_NOISE_PATTERNS.some((re) => re.test(msg))).toBe(true)
    },
  )

  it.each(['Failed to fetch', 'Network request failed', 'boom', ''])('does not match %j', (msg) => {
    expect(isDeployNoiseMessage(msg)).toBe(false)
  })

  /*
   * Инвариант: deploy-noise паттерны НЕ должны попадать в stale-chunk-распознавание,
   * иначе chunk-reload-guard (isStaleChunkError → verifyAndReload) начнёт перезагружать
   * страницу на каждый транзиентный manifest-сбой. Эти паттерны живут отдельно и
   * используются только Sentry-фильтром.
   */
  it('manifest-ошибка НЕ распознаётся как stale-chunk (не триггерит reload)', () => {
    const manifestMsg = '[nuxt] Error fetching app manifest. TypeError: Failed to fetch'
    expect(isStaleChunkMessage(manifestMsg)).toBe(false)
    expect(isStaleChunkError(new Error(manifestMsg))).toBe(false)
    expect(STALE_CHUNK_PATTERNS.some((re) => re.test(manifestMsg))).toBe(false)
  })
})

describe('isStaleChunkError', () => {
  it('Error instance with stale message → true', () => {
    expect(isStaleChunkError(new Error("Couldn't resolve component Foo"))).toBe(true)
  })
  it('Error instance with unrelated message → false', () => {
    expect(isStaleChunkError(new Error('boom'))).toBe(false)
  })
  it('plain string with stale text → true', () => {
    expect(isStaleChunkError('Failed to fetch dynamically imported module')).toBe(true)
  })
  it('object with .message field → checked', () => {
    expect(isStaleChunkError({ message: 'Importing a module script failed' })).toBe(true)
  })
  it('null / undefined / number → false', () => {
    expect(isStaleChunkError(null)).toBe(false)
    // oxlint-disable-next-line unicorn/no-useless-undefined -- undefined здесь обязательный аргумент-кейс
    expect(isStaleChunkError(undefined)).toBe(false)
    expect(isStaleChunkError(42)).toBe(false)
  })
})
