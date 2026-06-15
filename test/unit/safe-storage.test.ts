import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createSafeSessionStorage } from '../../src/runtime/safe-storage'

/* Vitest default env — node, без window/sessionStorage. Каждый describe
 * сам определяет требуемое поведение globalThis.sessionStorage через
 * Object.defineProperty, afterEach восстанавливает дескриптор. */
const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')

afterEach(() => {
  if (originalDescriptor) {
    Object.defineProperty(globalThis, 'sessionStorage', originalDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
})

function installStorageMock(value: Storage | (() => Storage)): void {
  if (typeof value === 'function') {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      get: value,
    })
  } else {
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      writable: true,
      value,
    })
  }
}

function createInMemoryStorage(): Storage {
  const store = new Map<string, string>()
  return {
    getItem: (key): string | null => store.get(key) ?? null,
    setItem: (key, value): void => {
      store.set(key, value)
    },
    removeItem: (key): void => {
      store.delete(key)
    },
    clear: (): void => {
      store.clear()
    },
    key: (): string | null => null,
    get length(): number {
      return store.size
    },
  }
}

describe('createSafeSessionStorage — happy path (backend доступен)', () => {
  let backend: Storage
  beforeEach(() => {
    backend = createInMemoryStorage()
    installStorageMock(backend)
  })

  it('пишет и читает через реальный backend', () => {
    const storage = createSafeSessionStorage()
    storage.setItem('key', 'value')
    expect(storage.getItem('key')).toBe('value')
    expect(backend.getItem('key')).toBe('value')
  })

  it('возвращает null для отсутствующих ключей', () => {
    const storage = createSafeSessionStorage()
    expect(storage.getItem('missing')).toBeNull()
  })

  it('probe-ключ не остаётся в storage после init', () => {
    createSafeSessionStorage()
    expect(backend.getItem('__nuxt_stale_deploy_guard_probe__')).toBeNull()
  })
})

describe('createSafeSessionStorage — fallback при SecurityError на property-read', () => {
  beforeEach(() => {
    /* Имитация restricted-браузера: сам доступ `globalThis.sessionStorage`
     * throw'ит DOMException SecurityError (Chrome Mobile в Telegram WebView). */
    installStorageMock(() => {
      throw new Error('SecurityError: Access is denied for this document')
    })
  })

  it("не throw'ит при создании", () => {
    expect(() => createSafeSessionStorage()).not.toThrow()
  })

  it('работает с in-memory fallback', () => {
    const storage = createSafeSessionStorage()
    storage.setItem('key', 'value')
    expect(storage.getItem('key')).toBe('value')
    expect(storage.getItem('other')).toBeNull()
  })
})

describe('createSafeSessionStorage — fallback при throw на setItem', () => {
  beforeEach(() => {
    /* Доступ к объекту разрешён, но `setItem` throw'ит — классический
     * Safari Private Mode сценарий. Probe-write упадёт → backend disabled. */
    installStorageMock({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError: The operation is insecure')
      },
      removeItem: () => {},
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage)
  })

  it("создание не throw'ит", () => {
    expect(() => createSafeSessionStorage()).not.toThrow()
  })

  it('setItem/getItem работают через memory', () => {
    const storage = createSafeSessionStorage()
    storage.setItem('key', 'value')
    expect(storage.getItem('key')).toBe('value')
  })
})

describe('createSafeSessionStorage — runtime degradation', () => {
  let throwOnNext = false

  beforeEach(() => {
    throwOnNext = false
    const store = new Map<string, string>()
    installStorageMock({
      getItem: (key: string): string | null => {
        if (throwOnNext) {
          throw new Error('SecurityError: Access is denied')
        }
        return store.get(key) ?? null
      },
      setItem: (key: string, value: string): void => {
        if (throwOnNext) {
          throw new Error('SecurityError: Access is denied')
        }
        store.set(key, value)
      },
      removeItem: (key: string): void => {
        store.delete(key)
      },
      clear: () => {},
      key: () => null,
      length: 0,
    } as Storage)
  })

  it("переключается на memory если backend начал throw'ить", () => {
    const storage = createSafeSessionStorage()
    storage.setItem('a', '1')
    expect(storage.getItem('a')).toBe('1')

    /* Бэкенд начинает throw'ить mid-session — wrapper должен молча
     * переключиться на memory и продолжить отдавать корректные значения. */
    throwOnNext = true
    storage.setItem('b', '2')
    expect(storage.getItem('a')).toBe('1')
    expect(storage.getItem('b')).toBe('2')
  })
})

describe('createSafeSessionStorage — globalThis.sessionStorage = undefined (SSR-like)', () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, 'sessionStorage')
  })

  it("не throw'ит и работает через memory", () => {
    const storage = createSafeSessionStorage()
    storage.setItem('key', 'value')
    expect(storage.getItem('key')).toBe('value')
  })
})
