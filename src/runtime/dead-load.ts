import { CHUNK_RELOAD_COOLDOWN_KEY, CHUNK_RELOAD_COOLDOWN_MS } from './chunk-reload-guard'
import { buildInlineScreenHelpers, type InlineScreenConfig } from './inline-screen'
import { LOAD_SCAN_HELPERS } from './load-scan'
import { DEFAULT_SCREEN_THEME, DEFAULT_SCREEN_TEXTS } from './screen-config'

/*
 * Inline-скрипт «мёртвая первая загрузка»: сбой чанка/entry ДО `app:mounted` (Sentry KP-MODMB-COM-1H). Модуль
 * (`module.ts`) кладёт `DEAD_LOAD_SCRIPT` в `app.head.script` с `tagPosition: 'head'` и числовым `tagPriority`
 * — только в проде. Скрипт обязан стоять в HTML РАНЬШЕ entry `<script type="module">`: слушатели нужны до того,
 * как entry начнёт грузиться. Порядок задаёт абсолютный вес `DEAD_LOAD_SCRIPT_PRIORITY` (см. ниже), а не
 * вес по умолчанию: он зависит от версии unhead.
 *
 * Зачем. Nuxt-плагин `nuxt:router` — `enforce: 'pre'` и стартует первую навигацию внутри собственного setup,
 * поэтому динамический импорт чанка страницы падает РАНЬШЕ, чем зарегистрированы плагин guard и плагин Sentry.
 * Ретрай в `app:created` может пройти, но Nuxt показывает ошибку 500 «Failed to fetch dynamically imported
 * module: <url>» и не убирает её (`clearError` в `afterEach` пропускается, пока `isHydrating`). Итог — одна
 * транзитная ошибка сети = мёртвая вкладка без кнопки, без HEAD-проб и без события в Sentry: до guard доходит
 * только двойной сбой, и тогда пробы видят «билд актуален» и не перезагружают.
 *
 * Что делает скрипт (контракт зафиксирован владельцем модуля):
 *   1. Область: только сбои ДО `app:mounted` («pre-mount»). После монтирования клиентский плагин возвращается
 *      к прежнему поведению (verify-before-reload с HEAD-пробами и событиями not-stale / circuit-breaker /
 *      cooldown / no-build-id).
 *   2. Триггеры pre-mount: (a) событие window `vite:preloadError` → kind `chunk`, `error` = его `payload`;
 *      (c) `error`, пойманное на window в фазе capture, чьё событие цель — `<script type="module" src>` →
 *      kind `entry`, `url` = `src` (`error` у такого события нет: оно ошибки не несёт; `<link>` —
 *      modulepreload/stylesheet — игнорируются); (b) клиентский плагин зовёт `fail('chunk', error)` из хуков
 *      `app:chunkError`/`app:error`/`vue:error` и слушателей `unhandledrejection`/`error` (тот же фильтр
 *      `isStaleChunkError`, что и раньше). Любой из них сработает один раз за загрузку страницы: первый
 *      сбой побеждает, остальные игнорируются.
 *   3. HEAD-проб нет: скрипт реагирует сразу.
 *   4. Защита от петли — маркер `sdg-retry` в query текущего URL (значение `chunk` | `entry` — kind сбоя; по
 *      нему считаются успешные повторы в логах шлюза). Первый pre-mount сбой на URL БЕЗ маркера → оверлей
 *      «Загружаем страницу…» (`data-sdg-state="loading"`) → `location.replace` на тот же URL + `sdg-retry=<kind>`
 *      (путь, прочие параметры и hash сохраняются; смена URL заодно обходит HTTP-кеш устаревшего HTML).
 *      Сбой на URL, где маркер УЖЕ есть (любое значение), → экран «Страница не загрузилась»
 *      (`data-sdg-state="failed"`), без перезагрузки. Кнопка «Обновить» — `location.reload()`: маркер остаётся,
 *      одно нажатие = одна попытка. Если `location.replace` недоступен (бросает), скрипт сразу идёт на экран
 *      «не загрузилась». После успешного `app:mounted` плагин сам убирает из URL только ключ `sdg-retry`.
 *      Автоповтор — ОДНА автоматическая перезагрузка на цепочку сбоя, и тратит её любой автоматический reload, а
 *      не только свой: reload guard'а (chunk-reload-guard.ts) пишет в sessionStorage штамп
 *      `chunk-reload:last-reload-at` ПЕРЕД перезагрузкой, и штамп переживает её. Скрипт читает штамп в момент сбоя:
 *      моложе cooldown'а guard'а (10 с — те же ключ и порог, они вшиваются из его констант) значит «эту страницу
 *      открыл guard», её автоповтор уже потрачен — сбой идёт сразу на экран «не загрузилась» с `retry-failed`, а
 *      не на второй reload через долю секунды после первого (e2e ai.pushka.biz 35: «ровно один reload»). Штамп
 *      отсутствует, не число, старше cooldown'а или sessionStorage недоступен (SecurityError в WebView) —
 *      автоповтор как обычно. Экран на таком адресе показан БЕЗ маркера `sdg-retry`: «Обновить» — обычная
 *      перезагрузка, а следующая загрузка идёт по правилам первой.
 *   5. Событие `app:chunk-reload-blocked` с `RetryFailedBlockedDetail`
 *      (`{ reason: 'retry-failed', kind, error?, url? }`, контракт — chunk-reload-guard.ts) — ровно один раз
 *      за загрузку страницы, при достижении экрана «не загрузилась». Для первого (автоповторяемого) сбоя
 *      события нет: успешные повторы видны по `sdg-retry=` в логах шлюза. Отправляется синхронно; слушатель
 *      (ранний inline-beacon nuxt-sentry ≥ 0.11.0) стоит в head и к этому времени уже зарегистрирован.
 *   6. Если сработал экран «браузер без import maps» (importmap-check.ts, `window.stop()`), скрипт не делает
 *      ничего: общее состояние `__sdgDeadLoad.takenOver` выставлено ДО остановки, а `error` оборванных ею
 *      скриптов entry не должны ни перезагружать страницу, ни рисовать второй экран.
 *   7. Watchdog «приложение не загрузилось»: копит ВИДИМОЕ время (`loadTimeoutMs`, дефолт 45 с) с момента
 *      исполнения скрипта (он в head, значит раньше entry). Ждать таймером «на всё время» нельзя: у вкладки в
 *      фоне, заморозке или сне таймеры спят или срабатывают с опозданием, и отчёт «не загрузилось за 45 с»
 *      приходил от вкладки, которую никто не видел (Sentry KP-MODMB-COM-1J: 4 из 10 событий — восстановление
 *      сессии Chrome с девятью фоновыми вкладками и замороженная вкладка Android). Поэтому раз в секунду тик
 *      (`setInterval`) прибавляет к счётчику `min(прошло с прошлого тика, 2 с)` — и только пока
 *      `document.visibilityState` не `hidden` (устаревшее `prerender` — тоже скрыта; нет свойства — видима).
 *      Прошлый тик обновляется ВСЕГДА, а `visibilitychange` при возврате во вкладку сбрасывает его заново:
 *      скрытый кусок не засчитывается. Потолок в 2 с превращает «тиков не было, потом один с огромной разницей»
 *      (заморозка, сон ноутбука, скачок часов) в обычные 2 с, а не в десять минут «видимого» ожидания. Вкладка,
 *      которая так и не стала видимой, не шлёт ничего. Тик останавливается на `mounted()`, на отчёте, на экране
 *      «страница не загрузилась» и на `takenOver`; `loadTimeoutMs: 0` — тика нет вовсе.
 *      Счётчик дорос до `loadTimeoutMs`, а приложение НЕ смонтировалось и пользователю НЕ показан экран «страница
 *      не загрузилась» — событие `app:load-timeout` (контракт `LoadTimeoutDetail` — chunk-reload-guard.ts:
 *      `timeoutMs`, `visibleMs`, `hiddenMs`, `elapsedMs`, `url`, `kind?` и диагностика `stage`, `host?`,
 *      `readyState`, `online`, `pending`, `pendingCount`, `criticalCount`, `vueMounted`, `errors`). Ровно один
 *      раз за документ, в момент достижения порога: ни дополнительных событий, ни отложенной отправки на
 *      `pagehide`. Смысл: поймать «мёртвую первую загрузку» без ошибки в консоли (зависший entry, минувший
 *      CDN, зависший стиль в head, редирект на пустую страницу) — там, где ни один обработчик сбоя не
 *      сработал и в Sentry тишина. Автоповтор watchdog НЕ гасит: страница должна была уйти на перезагрузку;
 *      если не ушла — это ровно тот случай, о котором нужен отчёт (в detail попадает `kind` увиденного сбоя).
 *      Экран «браузер без import maps» watchdog тоже гасит (`takenOver`): там отчёт уже есть.
 *      Диагностика считается в момент отчёта. Критичные ресурсы документа и то, «завис» ли ресурс (нет записи
 *      Resource Timing), — скан из load-scan.ts. Есть зависшие ИЛИ `readyState === 'loading'` — стадия `network`
 *      (`host` — хост первого зависшего ресурса, а если зависших нет и документ ещё стримится, то `location.host`),
 *      иначе `boot`: всё пришло, приложение не поднялось. `errors` — первые три ошибки ДО монтирования:
 *      runtime-`error` на window (сбои загрузки элементов сюда не попадают: у них есть канал entry) и
 *      `unhandledrejection`.
 *   8. SSR-документ. Серверный плагин модуля (`plugin.server.ts`) ставит на `<html>` атрибут `data-sdg-ssr`
 *      (`SSR_MARKER_ATTR`, dead-load-bridge.ts); скрипт читает его ОДИН раз при старте (атрибуты `<html>` разобраны
 *      раньше head-скриптов), поэтому поздние правки атрибута другим кодом ничего не меняют. Такой
 *      документ не мёртв: содержимое уже в HTML и читается, обычные ссылки работают без JS, а оверлей или
 *      перезагрузка спрятали бы работающую страницу. На помеченном документе `fail()` не рисует оверлей, не зовёт
 *      `location.replace` и не шлёт `app:chunk-reload-blocked` — только помечает документ пережившим сбой
 *      (`handled()` → true: клиентский плагин молчит) и выходит; watchdog шлёт `app:load-timeout` ТОЛЬКО если среди
 *      зависших критичных ресурсов есть стиль (`stylePending`: пока он не пришёл, отрисовка заблокирована и страница
 *      действительно пуста), иначе молча останавливается. Документ без метки — SPA-оболочка (при `ssr: false`,
 *      глобальном или по `routeRules`, Nuxt не создаёт приложение на сервере и серверные плагины там не
 *      исполняются) — ведёт себя ровно как в пунктах 1–7.
 *
 * Мост для клиентского плагина — глобал `window.__sdgDeadLoad` (общее состояние из inline-screen.ts):
 *   - `fail(kind, error?, url?)` — сообщить о pre-mount сбое (`kind`: `'chunk'` | `'entry'`; иное значение
 *     считается `'chunk'`); идемпотентно;
 *   - `mounted()` — приложение смонтировалось: дальше скрипт ни на что не реагирует (уже показанный экран
 *     не убирается: смонтированное приложение могло показать страницу ошибки Nuxt, и он честнее) и
 *     останавливается watchdog;
 *   - `handled()` — «этот документ уже пережил сбой»: true с первого обработанного `fail` (ветка автоповтора,
 *     ветка экрана «не загрузилась» и молчаливое поглощение сбоя на SSR-документе), дальше только true. Нужен
 *     клиентскому плагину: после автоповтора или экрана документ уходит (навигация обрывает загрузку CSS его
 *     страницы ошибки) — и любой его сбой после этого не должен превращаться в ложный «билд актуален» (Sentry
 *     KP-MODMB-COM-1H, 21.10.2026).
 * Типы и чтение моста — `dead-load-bridge.ts` (плагин не импортирует этот модуль, чтобы текст скрипта не попал
 * в клиентский бандл). Нет глобала (dev, старый кешированный HTML) — плагин работает как раньше.
 *
 * Оформление и хелперы — inline-screen.ts (палитра и тексты проекта: опции модуля `theme`/`texts`, дефолты —
 * палитра ai.pushka.biz и её русские тексты; тёмная по умолчанию, светлая при `html.light` или
 * `prefers-color-scheme: light`; ES5; CSP: как и сам payload Nuxt, inline-скрипту при строгом CSP нужен
 * nonce/hash). Корень оверлея несёт `data-sdg-dead-load` (пустое значение) и `data-sdg-state`. Если `<body>`
 * ещё нет (сбой пришёл, пока парсится head), оверлей кладётся в `<html>`. В тексте скрипта нельзя бэктики,
 * `${`, `</script`, `<!--` и комментарии — они выше.
 */

/* Ключ дедупа unhead: повторная регистрация (второй вызов setup, layers) не задвоит скрипт. */
export const DEAD_LOAD_SCRIPT_KEY = 'stale-deploy-guard-dead-load'

/* Числовой `tagPriority` unhead — абсолютный вес: порядок «скрипт раньше entry» не зависит от версии unhead и
   от того, как она взвешивает inline- и module-скрипты (в unhead 2.1.13 из Nuxt 4.4 — 50 и 80). -1 — сразу
   после import map Nuxt (-2) и позже `<meta charset>` (-20), viewport (-15), CSP (-30) и base (-10). */
export const DEAD_LOAD_SCRIPT_PRIORITY = -1

/* Порог видимого времени watchdog'а «приложение не загрузилось» по умолчанию (45 с). */
export const DEFAULT_LOAD_TIMEOUT_MS = 45_000

/* Конфиг экрана по умолчанию — палитра ai.pushka.biz, её тексты и дефолтный таймаут watchdog'а. */
const DEFAULT_CONFIG: InlineScreenConfig = {
  theme: DEFAULT_SCREEN_THEME,
  texts: DEFAULT_SCREEN_TEXTS,
  loadTimeoutMs: DEFAULT_LOAD_TIMEOUT_MS,
}

/** Текст inline-скрипта «мёртвая первая загрузка» с палитрой, текстами и таймаутом watchdog'а проекта. */
export function buildDeadLoadScript(config: InlineScreenConfig = DEFAULT_CONFIG): string {
  return String.raw`(function () {
${buildInlineScreenHelpers(config)}
${LOAD_SCAN_HELPERS}
  var MARKER = 'sdg-retry';
  var COOLDOWN_KEY = ${JSON.stringify(CHUNK_RELOAD_COOLDOWN_KEY)};
  var COOLDOWN_MS = ${String(CHUNK_RELOAD_COOLDOWN_MS)};
  var SSR_ATTR = 'data-sdg-ssr';
  var TIMEOUT_MS = CFG.loadTimeoutMs;
  var TICK_MS = 1000;
  var TICK_CAP_MS = TICK_MS * 2;
  var ERRORS_LIMIT = 3;
  var MESSAGE_LIMIT = 200;
  var shared = sdgShared();
  var handled = false;
  var mounted = false;
  var failureScreenShown = false;
  var lastKind = null;
  var current = null;
  var startedAt = Date.now();
  var lastTick = startedAt;
  var visibleMs = 0;
  var watchdogTimer = null;
  var reported = false;
  var errors = [];
  var ssr = false;
  try {
    ssr = doc.documentElement.hasAttribute(SSR_ATTR);
  } catch (e) {}

  if (TIMEOUT_MS > 0) {
    try {
      watchdogTimer = win.setInterval(onTick, TICK_MS);
      doc.addEventListener('visibilitychange', onVisibility);
      win.addEventListener('unhandledrejection', onRejection);
    } catch (e) {}
  }

  function hasMarker() {
    return new RegExp('[?&]' + MARKER + '(=|&|$)').test(win.location.search);
  }

  function guardReloadedRecently() {
    try {
      var raw = win.sessionStorage.getItem(COOLDOWN_KEY);
      var last = raw ? Number(raw) : 0;
      return isFinite(last) && Date.now() - last < COOLDOWN_MS;
    } catch (e) {
      return false;
    }
  }

  function retryUrl(kind) {
    var href = win.location.href;
    var hashAt = href.indexOf('#');
    var base = hashAt < 0 ? href : href.slice(0, hashAt);
    var hash = hashAt < 0 ? '' : href.slice(hashAt);
    var glue = base.indexOf('?') < 0 ? '?' : /[?&]$/.test(base) ? '' : '&';
    return base + glue + MARKER + '=' + kind + hash;
  }

  function stopWatchdog() {
    if (watchdogTimer !== null) {
      try {
        win.clearInterval(watchdogTimer);
      } catch (e) {}
      watchdogTimer = null;
    }
    try {
      doc.removeEventListener('visibilitychange', onVisibility);
      win.removeEventListener('unhandledrejection', onRejection);
    } catch (e) {}
  }

  function isVisible() {
    var state = doc.visibilityState;
    return state !== 'hidden' && state !== 'prerender';
  }

  function onVisibility() {
    if (isVisible()) {
      lastTick = Date.now();
    }
  }

  function onTick() {
    if (reported || mounted || failureScreenShown || shared.takenOver) {
      stopWatchdog();
      return;
    }
    var now = Date.now();
    var gap = now - lastTick;
    lastTick = now;
    if (gap > 0 && isVisible()) {
      visibleMs += gap < TICK_CAP_MS ? gap : TICK_CAP_MS;
    }
    if (visibleMs >= TIMEOUT_MS) {
      report(now);
    }
  }

  function report(now) {
    reported = true;
    stopWatchdog();
    var scan = scanCritical();
    if (ssr && !scan.stylePending) {
      return;
    }
    var elapsed = now - startedAt;
    var detail = {
      reason: 'load-timeout',
      timeoutMs: TIMEOUT_MS,
      visibleMs: visibleMs,
      hiddenMs: elapsed > visibleMs ? elapsed - visibleMs : 0,
      elapsedMs: elapsed,
      url: win.location.href
    };
    if (lastKind) {
      detail.kind = lastKind;
    }
    try {
      describeLoad(detail, scan);
    } catch (e) {}
    sdgEmit('app:load-timeout', detail);
  }

  function describeLoad(detail, scan) {
    var readyState = String(doc.readyState);
    var nav = win.navigator;
    detail.stage = scan.pendingCount > 0 || readyState === 'loading' ? 'network' : 'boot';
    if (detail.stage === 'network') {
      detail.host = scan.firstHost || win.location.host;
    }
    detail.readyState = readyState;
    detail.online = !nav || typeof nav.onLine !== 'boolean' || nav.onLine;
    detail.pending = scan.pending;
    detail.pendingCount = scan.pendingCount;
    detail.criticalCount = scan.criticalCount;
    detail.vueMounted = hasVueApp();
    detail.errors = errors;
  }

  function noteError(message, filename, line, column) {
    if (TIMEOUT_MS <= 0 || mounted || reported || errors.length >= ERRORS_LIMIT) {
      return;
    }
    try {
      var item = { message: String(message).slice(0, MESSAGE_LIMIT) };
      if (filename) {
        item.source = urlParts(filename).path + ':' + (line || 0) + ':' + (column || 0);
      }
      errors.push(item);
    } catch (e) {}
  }

  function rejectionMessage(reason) {
    try {
      return reason && typeof reason.message === 'string' ? reason.message : String(reason);
    } catch (e) {
      return 'unknown';
    }
  }

  function onRejection(event) {
    noteError(rejectionMessage(event ? event.reason : undefined));
  }

  function present(state) {
    if (current && current.parentNode) {
      current.parentNode.removeChild(current);
    }
    var theme = sdgTheme();
    var overlay = sdgOverlay(theme);
    overlay.setAttribute('data-sdg-dead-load', '');
    overlay.setAttribute('data-sdg-state', state);
    var card = sdgCard(overlay);
    var button = null;
    if (state === 'loading') {
      overlay.setAttribute('role', 'status');
      sdgAdd(card, 'p', 'margin:0;font-size:18px;line-height:1.4;font-weight:600;text-align:center', CFG.texts.loading);
    } else {
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'sdg-dead-load-title');
      sdgTitle(card, theme, CFG.texts.failedTitle).id = 'sdg-dead-load-title';
      sdgText(card, CFG.texts.failedAdvice);
      button = sdgButton(card, theme, CFG.texts.reload);
      button.onclick = function () {
        win.location.reload();
      };
    }
    sdgShow(overlay);
    current = overlay;
    if (button) {
      try {
        button.focus();
      } catch (e) {}
    }
  }

  function fail(kind, error, url) {
    if (handled || mounted || shared.takenOver) {
      return;
    }
    handled = true;
    var type = kind === 'entry' ? 'entry' : 'chunk';
    lastKind = type;
    if (ssr) {
      return;
    }
    if (!hasMarker() && !guardReloadedRecently()) {
      try {
        present('loading');
      } catch (e) {}
      try {
        win.location.replace(retryUrl(type));
        return;
      } catch (e) {}
    }
    failureScreenShown = true;
    stopWatchdog();
    try {
      present('failed');
    } catch (e) {}
    var detail = { reason: 'retry-failed', kind: type };
    if (error !== undefined && error !== null) {
      detail.error = error;
    }
    if (url) {
      detail.url = url;
    }
    sdgEmit('app:chunk-reload-blocked', detail);
  }

  win.addEventListener('vite:preloadError', function (event) {
    fail('chunk', event ? event.payload : undefined);
  });
  win.addEventListener(
    'error',
    function (event) {
      var target = event ? event.target : null;
      if (!target || !target.tagName) {
        if (event && typeof event.message === 'string') {
          noteError(event.message, event.filename, event.lineno, event.colno);
        }
        return;
      }
      if (!/^script$/i.test(target.tagName) || String(target.type).toLowerCase() !== 'module' || !target.src) {
        return;
      }
      fail('entry', undefined, target.src);
    },
    true
  );

  shared.fail = fail;
  shared.handled = function () {
    return handled;
  };
  shared.mounted = function () {
    mounted = true;
    stopWatchdog();
  };
})();`
}

export const DEAD_LOAD_SCRIPT = buildDeadLoadScript()
