import { INLINE_SCREEN_HELPERS } from './inline-screen'

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
 *
 * Мост для клиентского плагина — глобал `window.__sdgDeadLoad` (общее состояние из inline-screen.ts):
 *   - `fail(kind, error?, url?)` — сообщить о pre-mount сбое (`kind`: `'chunk'` | `'entry'`; иное значение
 *     считается `'chunk'`); идемпотентно;
 *   - `mounted()` — приложение смонтировалось: дальше скрипт ни на что не реагирует (уже показанный экран
 *     не убирается: смонтированное приложение могло показать страницу ошибки Nuxt, и он честнее).
 * Типы и чтение моста — `dead-load-bridge.ts` (плагин не импортирует этот модуль, чтобы текст скрипта не попал
 * в клиентский бандл). Нет глобала (dev, старый кешированный HTML) — плагин работает как раньше.
 *
 * Оформление и хелперы — inline-screen.ts (палитра ai.pushka.biz, тёмная по умолчанию, светлая при `html.light`
 * или `prefers-color-scheme: light`; ES5; CSP: как и сам payload Nuxt, inline-скрипту при строгом CSP нужен
 * nonce/hash). Корень оверлея несёт `data-sdg-dead-load` (пустое значение) и `data-sdg-state`; тексты не
 * настраиваются. Если `<body>` ещё нет (сбой пришёл, пока парсится head), оверлей кладётся в `<html>`.
 * В тексте скрипта нельзя бэктики, `${`, `</script`, `<!--` и комментарии — они выше.
 */

/* Ключ дедупа unhead: повторная регистрация (второй вызов setup, layers) не задвоит скрипт. */
export const DEAD_LOAD_SCRIPT_KEY = 'stale-deploy-guard-dead-load'

/* Числовой `tagPriority` unhead — абсолютный вес: порядок «скрипт раньше entry» не зависит от версии unhead и
   от того, как она взвешивает inline- и module-скрипты (в unhead 2.1.13 из Nuxt 4.4 — 50 и 80). -1 — сразу
   после import map Nuxt (-2) и позже `<meta charset>` (-20), viewport (-15), CSP (-30) и base (-10). */
export const DEAD_LOAD_SCRIPT_PRIORITY = -1

export const DEAD_LOAD_SCRIPT = String.raw`(function () {
${INLINE_SCREEN_HELPERS}
  var MARKER = 'sdg-retry';
  var shared = sdgShared();
  var handled = false;
  var mounted = false;
  var current = null;

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
      sdgAdd(card, 'p', 'margin:0;font-size:18px;line-height:1.4;font-weight:600;text-align:center', 'Загружаем страницу…');
    } else {
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'sdg-dead-load-title');
      sdgTitle(card, theme, 'Страница не загрузилась').id = 'sdg-dead-load-title';
      sdgText(card, 'Проверьте подключение к интернету и нажмите «Обновить».');
      button = sdgButton(card, theme, 'Обновить');
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
    if (!hasMarker()) {
      try {
        present('loading');
      } catch (e) {}
      try {
        win.location.replace(retryUrl(type));
        return;
      } catch (e) {}
    }
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
  shared.mounted = function () {
    mounted = true;
  };
})();`
