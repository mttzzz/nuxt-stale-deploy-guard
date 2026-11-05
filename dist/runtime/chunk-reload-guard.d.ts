export declare const CHUNK_RELOAD_COOLDOWN_KEY = "chunk-reload:last-reload-at";
export declare const CHUNK_RELOAD_ATTEMPTS_KEY = "chunk-reload:attempts";
export declare const CHUNK_RELOAD_COOLDOWN_MS = 10000;
export declare const CHUNK_RELOAD_CIRCUIT_WINDOW_MS: number;
export declare const CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS = 3;
export declare const CHUNK_RELOAD_PROBES = 4;
export declare const CHUNK_RELOAD_PROBE_DELAY_MS = 400;
/** Реактивная верификация: ни одна проба не увидела чужой build-id — чанк сломан не деплоем. */
export interface NotStaleBlockedDetail {
    reason: 'not-stale';
    error: unknown;
    probes: string[];
    buildId: string;
}
/** Reload хотели реактивная верификация или упавший переход, circuit breaker запретил.
 *  У перехода проб нет: `probes: []`. */
export interface CircuitBreakerBlockedDetail {
    reason: 'circuit-breaker';
    error: unknown;
    probes: string[];
    buildId: string;
    attempts: number;
    windowMs: number;
}
/** Реактивная верификация или reload упавшего перехода пропущены: идёт cooldown после reload, а чанк упал уже на НОВОЙ
 *  странице (cooldown пережил reload в sessionStorage). На странице, которая сама вызвала reload, — тишина. */
export interface CooldownBlockedDetail {
    reason: 'cooldown';
    error: unknown;
    buildId: string;
}
/** Реактивная верификация пропущена: у клиента нет build-id. */
export interface NoBuildIdBlockedDetail {
    reason: 'no-build-id';
    error: unknown;
}
/** Inline-скрипт (bodyClose, сразу после `window.stop()`): браузер без import maps, приложение не стартует. */
export interface UnsupportedBrowserBlockedDetail {
    reason: 'unsupported-browser';
    missing: 'importmap';
}
/** Что не загрузилось при `retry-failed`: чанк страницы (динамический импорт) или entry (`<script type="module">`). */
export type RetryFailedKind = 'chunk' | 'entry';
/** Inline-скрипт `dead-load.ts` (head): страница не загрузилась до `app:mounted` и после автоперезагрузки — показан
 *  экран «Страница не загрузилась». Автоперезагрузка уже была, если в URL есть маркер `sdg-retry` либо страницу
 *  меньше cooldown'а назад открыл reload guard'а (штамп в sessionStorage). `error` — исходная ошибка/payload, если
 *  она есть (у сбоя entry её нет: событие `error` скрипта ошибки не несёт); `url` — адрес скрипта entry, который не
 *  загрузился. Приходит ровно один раз за загрузку страницы; на документе, отрендеренном на сервере (метка
 *  `data-sdg-ssr` на `<html>`), не приходит вовсе: страница читается, экрана нет. */
export interface RetryFailedBlockedDetail {
    reason: 'retry-failed';
    kind: RetryFailedKind;
    error?: unknown;
    url?: string;
}
/** Исходы реактивной верификации — то, что `createChunkReloadGuard` шлёт через `deps.dispatchBlocked`. */
export type ChunkReloadBlockedDetail = NotStaleBlockedDetail | CircuitBreakerBlockedDetail | CooldownBlockedDetail | NoBuildIdBlockedDetail;
/** Полный detail события `app:chunk-reload-blocked` на window: исходы guard + inline-скрипты. */
export type ChunkReloadBlockedEventDetail = ChunkReloadBlockedDetail | UnsupportedBrowserBlockedDetail | RetryFailedBlockedDetail;
/** Имя события watchdog'а «приложение не загрузилось». */
export declare const LOAD_TIMEOUT_EVENT = "app:load-timeout";
/** Стадия, на которой застала мёртвая загрузка (`LoadTimeoutDetail.stage`): `network` — не пришли ресурсы
 *  документа (есть «зависшие» критичные ресурсы ИЛИ документ ещё стримится, `readyState === 'loading'`);
 *  `boot` — всё пришло, а приложение не поднялось (ошибка старта, зависший top-level await и т.п.). */
export type LoadTimeoutStage = 'network' | 'boot';
/** Ошибка, которую inline-скрипт поймал ДО монтирования: runtime-`error` на window или `unhandledrejection`. */
export interface LoadTimeoutError {
    /** `ErrorEvent.message`; у `unhandledrejection` — `reason.message` (строка) либо `String(reason)`. До 200 символов. */
    message: string;
    /** `host + pathname:line:col` из `ErrorEvent.filename`, если он есть. У `unhandledrejection` и cross-origin
     *  «Script error.» поля нет. */
    source?: string;
}
/** Detail события `app:load-timeout` — приложение не смонтировалось за отведённое ВИДИМОЕ время.
 *
 *  Шлёт inline-скрипт `dead-load.ts` (head) — единственное место, где видно «приложение вообще не
 *  стартовало»: ни один обработчик сбоя не сработал, ошибок в консоли нет, а вкладка просто мёртвая.
 *  Отчёт уходит ОДИН раз за документ, в момент достижения порога, и только если приложение не смонтировалось
 *  и пользователю не был показан экран «страница не загрузилась» (для него есть своё событие `retry-failed`).
 *  На документе, отрендеренном на сервере (метка `data-sdg-ssr` на `<html>`), — только если среди зависших
 *  критичных ресурсов есть стиль: он блокирует отрисовку, и страница действительно пуста; иначе содержимое
 *  читается и без JS, и отчёта нет.
 *
 *  Время. Считается только то, что вкладка пробыла на экране: скрытая, замороженная и уснувшая вкладка
 *  счётчик не двигает, а вкладка, так и не ставшая видимой, не шлёт ничего. `timeoutMs` — порог видимого
 *  ожидания (опция модуля `loadTimeoutMs`, дефолт 45_000); `visibleMs` — сколько видимого времени накопилось к
 *  моменту отчёта (≥ `timeoutMs`); `elapsedMs` — сколько реально прошло по часам с исполнения скрипта;
 *  `hiddenMs = max(0, elapsedMs - visibleMs)` — сколько из этого вкладка была скрыта, заморожена или спала.
 *
 *  Куда смотреть. `url` — адрес страницы; `kind` — что не загрузилось, если скрипт к тому времени уже видел
 *  сбой (`chunk` | `entry`), иначе поля нет: сбоя не было, приложение просто не стартовало. Остальное — диагностика
 *  на момент отчёта:
 *   - «критичные» ресурсы документа: `link[href]` с `stylesheet` (кроме `alternate`, `disabled` и `media`,
 *     которому не отвечает `matchMedia`) и с `modulepreload`; `script[src]` кроме классических (не `module`) с
 *     `async` или `nomodule` — браузер, исполняющий module-entry, `nomodule`-скрипты не грузит, и они вечно числились
 *     бы «зависшими» (на `type="module"` атрибут `nomodule` не действует). `prefetch`/`preload`/`icon`/`preconnect`
 *     не критичны. `criticalCount` — сколько их в документе;
 *   - `pending` — «зависшие» критичные ресурсы: у абсолютного URL (`el.href`/`el.src`) нет записи в
 *     `performance.getEntriesByType('resource')` (она появляется, когда загрузка завершилась). Не больше 5,
 *     в порядке документа, каждый как `host + pathname` (без query и hash), обрезан до 120 символов;
 *     `pendingCount` — сколько их всего. Нет Resource Timing или он бросил — `pending: []`, `pendingCount: 0`;
 *   - `stage`: `network`, если есть зависшие ИЛИ `readyState === 'loading'`; иначе `boot`. `host` есть только у
 *     `network`: хост первого зависшего ресурса, а если зависших нет (документ ещё стримится) — `location.host`;
 *   - `readyState` — `document.readyState`; `online` — `navigator.onLine` (`true`, если свойства нет);
 *     `vueMounted` — в документе есть элемент с `[data-v-app]`: Vue смонтирован, но плагин guard `mounted()`
 *     так и не вызвал;
 *   - `errors` — первые три ошибки ДО монтирования (пустой массив, если их не было). */
export interface LoadTimeoutDetail {
    reason: 'load-timeout';
    timeoutMs: number;
    visibleMs: number;
    hiddenMs: number;
    elapsedMs: number;
    url: string;
    kind?: RetryFailedKind;
    stage: LoadTimeoutStage;
    host?: string;
    readyState: string;
    online: boolean;
    pending: string[];
    pendingCount: number;
    criticalCount: number;
    vueMounted: boolean;
    errors: LoadTimeoutError[];
}
export interface ChunkReloadDeps {
    getBuildId: () => string;
    reload: (path?: string) => void;
    fetchServerBuildId: (path: string, attempt?: number) => Promise<string>;
    now: () => number;
    sleep?: (ms: number) => Promise<void>;
    storage: Pick<Storage, 'getItem' | 'setItem'>;
    dispatchBlocked: (detail: ChunkReloadBlockedDetail) => void;
}
export interface ChunkReloadGuard {
    verifyAndReload: (path?: string, error?: unknown) => Promise<void>;
    verifyConvergedAndReload: (path?: string) => Promise<void>;
    handleStaleChunkError: (err: unknown, path?: string) => void;
    handleFailedNavigation: (err: unknown, target: string) => void;
}
export declare function createChunkReloadGuard(deps: ChunkReloadDeps): ChunkReloadGuard;
