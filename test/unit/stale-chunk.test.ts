import { describe, it, expect } from 'vitest'

import { isStaleChunkError, isStaleChunkMessage, STALE_CHUNK_PATTERNS } from '../../src/runtime/stale-chunk'

describe('STALE_CHUNK_PATTERNS', () => {
  it.each([
    'Failed to fetch dynamically imported module: /_nuxt/abc.js',
    'error loading dynamically imported module',
    'Importing a module script failed.',
    'Couldn\'t resolve component Foo',
  ])('matches %j', (msg) => {
    expect(STALE_CHUNK_PATTERNS.some(re => re.test(msg))).toBe(true)
  })

  it.each(['Cannot read properties of undefined', 'Network request failed', ''])('does not match %j', (msg) => {
    expect(STALE_CHUNK_PATTERNS.some(re => re.test(msg))).toBe(false)
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

describe('isStaleChunkError', () => {
  it('Error instance with stale message → true', () => {
    expect(isStaleChunkError(new Error('Couldn\'t resolve component Foo'))).toBe(true)
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
    expect(isStaleChunkError(undefined)).toBe(false)
    expect(isStaleChunkError(42)).toBe(false)
  })
})
