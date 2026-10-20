import type { RetryFailedKind } from './chunk-reload-guard'

/*
 * Мост клиентского плагина (`plugin.client.ts`) к inline-скрипту «мёртвая первая загрузка» (`dead-load.ts`).
 * Отдельный модуль, а не часть dead-load.ts: плагин живёт в клиентском бандле консьюмера, и импорт текста
 * скрипта (~5 КБ) утащил бы его туда же.
 *
 * Скрипт стоит в head и кладёт мост в общее состояние — `window.__sdgDeadLoad` (см. inline-screen.ts):
 *   - `fail(kind, error?, url?)` — pre-mount сбой чанка: скрипт сам решает — повтор с маркером `sdg-retry` или
 *     экран «Страница не загрузилась» + событие `retry-failed`. Идемпотентно (реагирует на первый сбой);
 *   - `mounted()` — `app:mounted` случился: скрипт больше ни на что не реагирует.
 * Моста нет (dev, где inline-скрипты не добавляются, или старый кешированный HTML без него) — плагин ведёт
 * себя как раньше: HEAD-пробы, verify-before-reload и события not-stale/circuit-breaker/cooldown.
 *
 * `RETRY_MARKER_KEY` — ключ query, который скрипт ставит на URL при автоповторе, а плагин убирает из URL после
 * `app:mounted`. Литерал `sdg-retry` есть и в тексте скрипта (там строка, а не импорт); их равенство держит
 * тест, который гоняет и скрипт, и плагин.
 */

export const RETRY_MARKER_KEY = 'sdg-retry'
export const DEAD_LOAD_GLOBAL = '__sdgDeadLoad'

export interface DeadLoadBridge {
  fail: (kind: RetryFailedKind, error?: unknown, url?: string) => void
  mounted: () => void
}

function isDeadLoadBridge(value: unknown): value is DeadLoadBridge {
  return (
    typeof value === 'object' &&
    value !== null &&
    'fail' in value &&
    typeof value.fail === 'function' &&
    'mounted' in value &&
    typeof value.mounted === 'function'
  )
}

/* Мост inline-скрипта, если он есть на странице. Читается один раз при старте плагина. */
export function readDeadLoadBridge(): DeadLoadBridge | undefined {
  const candidate: unknown = Reflect.get(globalThis, DEAD_LOAD_GLOBAL)
  return isDeadLoadBridge(candidate) ? candidate : undefined
}
