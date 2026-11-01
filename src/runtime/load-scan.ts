/*
 * ES5-хелперы скана критичных ресурсов документа для watchdog'а «приложение не загрузилось» (`dead-load.ts`):
 * какие из них ещё не пришли. Отдельный модуль по той же схеме, что и `inline-screen.ts`: текст — СТРОКА в
 * синтаксисе ES5, которую `buildDeadLoadScript` вшивает в IIFE скрипта (хелперы живут в его замыкании, в `window`
 * ничего не торчит), а `dead-load.ts` без этого упирается в лимит `max-lines`. Из замыкания хелперы берут только
 * `doc` и `win` (их объявляют хелперы inline-screen.ts) — остальное объявляют сами. Правила текста те же, что у
 * остальных inline-скриптов: ES5, нельзя бэктики, `${`, `</script`, `<!--` и комментарии — они здесь, выше.
 *
 * Что внутри:
 *   - `urlParts(value)` — `{ host, path }` абсолютного адреса: `host` — с портом, `path` — `host + pathname` без
 *     query и hash, не длиннее 120 символов (токены из query в отчёт попасть не должны);
 *   - `scanCritical()` — обход `link[href], script[src]`: `{ criticalCount, pending, pendingCount, firstHost,
 *     stylePending }`; не бросает;
 *   - `hasVueApp()` — в документе есть `[data-v-app]`: Vue смонтирован.
 *
 * Критичные ресурсы — то, без чего приложение не стартует: `link[href]` с `stylesheet` (кроме `alternate`,
 * `disabled` и `media`, которому не отвечает `matchMedia`) и с `modulepreload`; `script[src]` кроме классических с
 * `async` или `nomodule` (браузер с module-entry их не грузит, они остались бы «зависшими»; на module-скрипты
 * атрибут не действует). `prefetch`/`preload`/`icon`/`preconnect` не в счёт. Критичный ресурс «завис» (pending),
 * если для его абсолютного URL (`el.href`/`el.src`) нет записи Resource Timing — запись появляется, когда загрузка
 * завершилась; нет API или он бросил — `pending: []`.
 *
 * `stylePending` — среди зависших есть стиль (`<link rel="stylesheet">`). Стиль блокирует отрисовку: пока он не
 * пришёл, страница пуста. По этому признаку watchdog решает, слать ли отчёт с документа, отрендеренного на
 * сервере (там содержимое уже в HTML и без скриптов читается; см. «SSR-документ» в `dead-load.ts`).
 */

/** ES5-хелперы скана критичных ресурсов: вшиваются в IIFE `dead-load.ts` после хелперов inline-экрана. */
export const LOAD_SCAN_HELPERS = String.raw`  var PENDING_LIMIT = 5;
  var PATH_LIMIT = 120;

  function urlParts(value) {
    var link = doc.createElement('a');
    link.href = value;
    return { host: link.host, path: (link.host + link.pathname).slice(0, PATH_LIMIT) };
  }

  function mediaMatches(media) {
    try {
      return !win.matchMedia || win.matchMedia(media).matches;
    } catch (e) {
      return true;
    }
  }

  function isCritical(node) {
    if (/^script$/i.test(node.tagName)) {
      var classic = String(node.type).toLowerCase() !== 'module';
      return !classic || !(node.async || node.hasAttribute('async') || node.hasAttribute('nomodule'));
    }
    var rel = String(node.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    if (rel.indexOf('modulepreload') >= 0) {
      return true;
    }
    if (rel.indexOf('stylesheet') < 0 || rel.indexOf('alternate') >= 0) {
      return false;
    }
    if (node.disabled || node.hasAttribute('disabled')) {
      return false;
    }
    var media = node.getAttribute('media');
    return !media || mediaMatches(media);
  }

  function loadedResources() {
    try {
      var perf = win.performance;
      if (!perf || typeof perf.getEntriesByType !== 'function') {
        return null;
      }
      var entries = perf.getEntriesByType('resource');
      var loaded = {};
      for (var i = 0; i < entries.length; i++) {
        loaded[entries[i].name] = true;
      }
      return loaded;
    } catch (e) {
      return null;
    }
  }

  function scanCritical() {
    var scan = { criticalCount: 0, pending: [], pendingCount: 0, firstHost: '', stylePending: false };
    try {
      var loaded = loadedResources();
      var nodes = doc.querySelectorAll('link[href], script[src]');
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!isCritical(node)) {
          continue;
        }
        scan.criticalCount++;
        var script = /^script$/i.test(node.tagName);
        var url = script ? node.src : node.href;
        if (loaded === null || loaded[url] === true) {
          continue;
        }
        scan.pendingCount++;
        if (!script && /(^|\s)stylesheet(\s|$)/i.test(node.getAttribute('rel'))) {
          scan.stylePending = true;
        }
        if (scan.pendingCount <= PENDING_LIMIT) {
          var parts = urlParts(url);
          scan.pending.push(parts.path);
          if (scan.pendingCount === 1) {
            scan.firstHost = parts.host;
          }
        }
      }
    } catch (e) {}
    return scan;
  }

  function hasVueApp() {
    try {
      return !!doc.querySelector('[data-v-app]');
    } catch (e) {
      return false;
    }
  }
`
