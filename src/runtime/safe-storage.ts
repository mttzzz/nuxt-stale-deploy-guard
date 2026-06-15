/*
 * Безопасный wrapper над `window.sessionStorage` для restricted-браузеров.
 *
 * В Telegram/Instagram/Facebook in-app WebView, iOS Safari Private Mode,
 * некоторых Android-WebView, любой доступ к `window.sessionStorage` (даже
 * как property-read!) throw'ит DOMException SecurityError:
 *   - Chrome:  «Failed to read the 'sessionStorage' property from 'Window':
 *              Access is denied for this document.»
 *   - Firefox: «The operation is insecure.»
 * Прямая передача `sessionStorage` в `createChunkReloadGuard({ storage })`
 * приводила к синхронному throw'у при инициализации плагина (Sentry KP-MODMB-COM-K).
 *
 * Этот wrapper:
 *   1. Probe'ит sessionStorage один раз при создании внутри try/catch
 *      (включая `setItem`/`removeItem` — некоторые браузеры дают доступ
 *      к объекту, но throw'ят на write — quota / restricted iframe).
 *   2. Если probe прошёл — read/write идут в реальный sessionStorage.
 *   3. Если probe или runtime-op кинули throw — fall back на in-memory Map.
 *      Backend перманентно отключается чтобы не разъезжалась консистентность.
 *
 * Замечание про in-memory fallback: state теряется между навигациями (не
 * tab-shared). Для chunk-reload-guard cooldown/circuit-breaker это OK — в
 * restricted-режиме браузер всё равно сбрасывает state на каждую навигацию.
 */

export interface SafeStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

const PROBE_KEY = '__nuxt_stale_deploy_guard_probe__'

export function createSafeSessionStorage(): SafeStorage {
  const memory = new Map<string, string>()
  let backend: Storage | null = null

  try {
    /* Сам доступ `globalThis.sessionStorage` может throw'нуть SecurityError. */
    const probe = globalThis.sessionStorage
    if (probe) {
      probe.setItem(PROBE_KEY, '1')
      probe.removeItem(PROBE_KEY)
      backend = probe
    }
  } catch {
    backend = null
  }

  return {
    getItem(key) {
      if (backend) {
        try {
          return backend.getItem(key)
        } catch {
          backend = null
        }
      }
      return memory.get(key) ?? null
    },
    setItem(key, value) {
      /* Memory держим всегда актуальным, чтобы при runtime-degradation
       * (backend сначала работал, потом начал throw'ить) не потерять state. */
      memory.set(key, value)
      if (backend) {
        try {
          backend.setItem(key, value)
        } catch {
          backend = null
        }
      }
    },
  }
}
