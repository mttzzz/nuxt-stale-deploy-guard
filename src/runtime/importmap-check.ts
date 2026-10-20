import { INLINE_SCREEN_HELPERS } from './inline-screen'

/*
 * Inline-проверка import maps + экран-заглушка для браузеров без их поддержки. Модуль (`module.ts`)
 * кладёт `IMPORTMAP_CHECK_SCRIPT` в `app.head.script` с `tagPosition: 'bodyClose'` — только в проде.
 *
 * Прод-инцидент ai.pushka.biz 15.10.2026: iPhone на iOS 16.0.2 (WebKit без import maps, они с Safari 16.4)
 * открывал инвайт → `500 Module specifier, '#entry' does not start with "/", "./", or "../"`. Nuxt 4.1+
 * кладёт entry в `<script type="importmap">` под ключом `#entry`, страницы-чанки импортируют `"#entry"`,
 * без import maps импорт падает. Дальше цепочка тишины: Vite шлёт `vite:preloadError` → guard глотает
 * (preventDefault) → vue-router бросает `Couldn't resolve component` → ignoreErrors режет его в Sentry →
 * 4 HEAD-пробы, build-id совпал → ничего. Юзер на 500, в Sentry ноль.
 *
 * Что делает скрипт (порядок важен):
 *   1. На странице нет `script[type="importmap"]` → выход (Nuxt < 4.1 или `entryImportMap: false`:
 *      entry грузится без import map, приложение работает).
 *   2. `HTMLScriptElement.supports('importmap') === true` → выход. Метода нет ИЛИ он вернул не `true` —
 *      браузер без import maps.
 *   3. Общее состояние (`window.__sdgDeadLoad`, см. inline-screen.ts) помечается `takenOver = true` — ДО
 *      `window.stop()`: оборванные остановкой загрузки скриптов entry шлют `error`, и скрипт «страница не
 *      загрузилась» (dead-load.ts) на них не должен ни перезагружать страницу, ни рисовать второй экран, ни
 *      слать `retry-failed`.
 *   4. `window.stop()`: парсер прерывается, deferred module-скрипты entry не исполняются, приложение не
 *      стартует (SDK тоже — поэтому отчёт шлёт ранний inline-слушатель nuxt-sentry, а не клиентский плагин).
 *   5. Событие `app:chunk-reload-blocked` с `UnsupportedBrowserBlockedDetail`
 *      (`{ reason: 'unsupported-browser', missing: 'importmap' }`, контракт — chunk-reload-guard.ts)
 *      ПОСЛЕ `window.stop()`: запрос, начатый слушателем уже после остановки, ею не обрывается ни в каком
 *      движке. Обратный порядок (отчёт до stop) держался на том, что движок не отменяет keepalive-запрос,
 *      уже ушедший в сеть, — в Chromium так, но под перехватом запросов (DevTools/Playwright) beacon
 *      обрывался (выкатка 15.10.2026), а WebKit iOS < 16.4, ради которого отчёт и нужен, проверить
 *      нечем. Фолбэк `createEvent('CustomEvent')` — для браузеров без конструктора CustomEvent.
 *   6. Экран: fixed-оверлей на весь экран (`z-index: 2147483647`), DOM через `createElement`/`textContent`
 *      (не innerHTML), цвета и стили — CSSOM (`style.cssText`), CSP `style-src` их не блокирует.
 *
 * Почему bodyClose: (а) `<script type="importmap">` из head уже в DOM; (б) скрипт исполняется во время
 * парсинга, раньше deferred module-скриптов entry.
 *
 * Палитра, вёрстка оверлея, отправка события и общее состояние — хелперы из inline-screen.ts (тот же
 * источник у экрана «страница не загрузилась»); там же объяснено, почему скрипт — СТРОКА в синтаксисе ES5
 * и что в её тексте нельзя (бэктики, `${`, `</script`, `<!--`, комментарии — они выше).
 *
 * Маркеры экрана (контракт для интеграционных проверок консьюмеров): корневой элемент оверлея несёт
 * атрибут `data-sdg-unsupported` (пустое значение), кнопка копирования — настоящий
 * `<button type="button">` с текстом «Скопировать ссылку», а «Ссылка скопирована» после успеха
 * появляется внутри корневого элемента.
 */

/* Ключ дедупа unhead: повторная регистрация (второй вызов setup, layers) не задвоит скрипт. */
export const IMPORTMAP_CHECK_SCRIPT_KEY = 'stale-deploy-guard-importmap-check'

export const IMPORTMAP_CHECK_SCRIPT = String.raw`(function () {
${INLINE_SCREEN_HELPERS}
  if (!doc.querySelector('script[type="importmap"]')) {
    return;
  }
  var Script = win.HTMLScriptElement;
  if (Script && typeof Script.supports === 'function' && Script.supports('importmap') === true) {
    return;
  }

  sdgShared().takenOver = true;
  try {
    if (win.stop) {
      win.stop();
    }
  } catch (e) {}
  sdgEmit('app:chunk-reload-blocked', { reason: 'unsupported-browser', missing: 'importmap' });

  var ua = navigator.userAgent || '';
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var theme = sdgTheme();

  var overlay = sdgOverlay(theme);
  overlay.setAttribute('data-sdg-unsupported', '');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'sdg-importmap-title');
  var card = sdgCard(overlay);
  var title = sdgTitle(card, theme, ios ? 'Версия iOS устарела' : 'Браузер устарел');
  title.id = 'sdg-importmap-title';
  var paragraphs = ios
    ? [
        'Нужна iOS 16.4 или новее: Настройки → Основные → Обновление ПО. Другой браузер на этом устройстве не поможет.',
        'Если обновление недоступно, скопируйте ссылку и откройте её на компьютере.'
      ]
    : ['Обновите браузер или откройте эту ссылку в другом браузере.'];
  for (var i = 0; i < paragraphs.length; i++) {
    sdgText(card, paragraphs[i]);
  }
  var field = sdgAdd(
    card,
    'input',
    'display:block;box-sizing:border-box;width:100%;margin:16px 0 0;padding:10px 12px;border:1px solid ' + theme.line +
      ';border-radius:8px;-webkit-appearance:none;appearance:none;background:' + theme.fieldBg + ';color:' + theme.fg +
      ';font-family:inherit;font-size:16px;line-height:1.4'
  );
  field.type = 'text';
  field.readOnly = true;
  field.value = win.location.href;
  field.setAttribute('aria-label', 'Адрес страницы');
  var button = sdgButton(card, theme, 'Скопировать ссылку');
  var note = sdgAdd(card, 'p', 'margin:12px 0 0;min-height:1.5em;font-size:14px;color:' + theme.muted);
  note.setAttribute('aria-live', 'polite');

  function report(copied) {
    note.textContent = copied ? 'Ссылка скопирована' : 'Не удалось скопировать — выделите адрес вручную';
  }
  function copyViaSelection() {
    var copied = false;
    try {
      field.focus();
      field.select();
      field.setSelectionRange(0, field.value.length);
    } catch (e) {}
    try {
      copied = doc.execCommand('copy') === true;
    } catch (e) {}
    report(copied);
  }
  button.onclick = function () {
    var clipboard = navigator.clipboard;
    if (clipboard && typeof clipboard.writeText === 'function') {
      try {
        clipboard.writeText(win.location.href).then(function () {
          report(true);
        }, copyViaSelection);
        return;
      } catch (e) {}
    }
    copyViaSelection();
  };

  sdgShow(overlay);
})();`
