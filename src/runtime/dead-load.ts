import { buildInlineScreenHelpers, type InlineScreenConfig } from './inline-screen'
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
 *   5. Событие `app:chunk-reload-blocked` с `RetryFailedBlockedDetail`
 *      (`{ reason: 'retry-failed', kind, error?, url? }`, контракт — chunk-reload-guard.ts) — ровно один раз
 *      за загрузку страницы, при достижении экрана «не загрузилась». Для первого (автоповторяемого) сбоя
 *      события нет: успешные повторы видны по `sdg-retry=` в логах шлюза. Отправляется синхронно; слушатель
 *      (ранний inline-beacon nuxt-sentry ≥ 0.11.0) стоит в head и к этому времени уже зарегистрирован.
 *   6. Если сработал экран «браузер без import maps» (importmap-check.ts, `window.stop()`), скрипт не делает
 *      ничего: общее состояние `__sdgDeadLoad.takenOver` выставлено ДО остановки, а `error` оборванных ею
 *      скриптов entry не должны ни перезагружать страницу, ни рисовать второй экран.
 *   7. Watchdog «приложение не загрузилось»: таймер на `loadTimeoutMs` (дефолт 45 с) стартует в момент
 *      исполнения скрипта (он в head, значит раньше entry). Если к сроку приложение НЕ смонтировалось и
 *      пользователю НЕ показан экран «страница не загрузилась» — событие `app:load-timeout`
 *      (`{ reason: 'load-timeout', timeoutMs, elapsedMs, url, kind? }`, контракт — chunk-reload-guard.ts).
 *      Ровно один раз за документ. Смысл: поймать «мёртвую первую загрузку» без ошибки в консоли (зависший
 *      entry, минувший CDN, редирект на пустую страницу) — там, где ни один обработчик сбоя не сработал и
 *      в Sentry тишина. Автоповтор watchdog НЕ гасит: страница должна была уйти на перезагрузку; если не
 *      ушла — это ровно тот случай, о котором нужен отчёт (в detail попадает `kind` увиденного сбоя).
 *      Экран «браузер без import maps» watchdog тоже гасит (`takenOver`): там отчёт уже есть.
 *
 * Мост для клиентского плагина — глобал `window.__sdgDeadLoad` (общее состояние из inline-screen.ts):
 *   - `fail(kind, error?, url?)` — сообщить о pre-mount сбое (`kind`: `'chunk'` | `'entry'`; иное значение
 *     считается `'chunk'`); идемпотентно;
 *   - `mounted()` — приложение смонтировалось: дальше скрипт ни на что не реагирует (уже показанный экран
 *     не убирается: смонтированное приложение могло показать страницу ошибки Nuxt, и он честнее) и
 *     останавливается watchdog;
 *   - `handled()` — «этот документ уже пережил сбой»: true с первого обработанного `fail` (и ветка автоповтора,
 *     и ветка экрана «не загрузилась»), дальше только true. Нужен клиентскому плагину: после автоповтора или
 *     экрана документ уходит (навигация обрывает загрузку CSS его страницы ошибки) — и любой его сбой после
 *     этого не должен превращаться в ложный «билд актуален» (Sentry KP-MODMB-COM-1H, 21.10.2026).
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

/* Таймаут watchdog'а «приложение не загрузилось» по умолчанию (45 с). */
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
  var MARKER = 'sdg-retry';
  var TIMEOUT_MS = CFG.loadTimeoutMs;
  var shared = sdgShared();
  var handled = false;
  var mounted = false;
  var failureScreenShown = false;
  var lastKind = null;
  var current = null;
  var startedAt = Date.now();
  var watchdogTimer = null;
  var reported = false;

  if (TIMEOUT_MS > 0) {
    watchdogTimer = win.setTimeout(onTimeout, TIMEOUT_MS);
  }

  function hasMarker() {
    return new RegExp('[?&]' + MARKER + '(=|&|$)').test(win.location.search);
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
        win.clearTimeout(watchdogTimer);
      } catch (e) {}
      watchdogTimer = null;
    }
  }

  function onTimeout() {
    watchdogTimer = null;
    if (reported || mounted || failureScreenShown || shared.takenOver) {
      return;
    }
    reported = true;
    var detail = {
      reason: 'load-timeout',
      timeoutMs: TIMEOUT_MS,
      elapsedMs: Date.now() - startedAt,
      url: win.location.href
    };
    if (lastKind) {
      detail.kind = lastKind;
    }
    sdgEmit('app:load-timeout', detail);
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
    if (!hasMarker()) {
      try {
        present('loading');
      } catch (e) {}
      try {
        win.location.replace(retryUrl(type));
        return;
      } catch (e) {}
    }
    failureScreenShown = true;
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
      if (
        !target ||
        !/^script$/i.test(target.tagName || '') ||
        String(target.type).toLowerCase() !== 'module' ||
        !target.src
      ) {
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
