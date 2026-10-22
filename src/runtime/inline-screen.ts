import { type ResolvedScreenTheme, type ScreenTexts, toInlineScriptLiteral } from './screen-config'

/*
 * Общие ES5-хелперы inline-экранов модуля — ОДИН источник для обоих скриптов, что рисуют полноэкранный
 * оверлей до старта приложения: `importmap-check.ts` («браузер без import maps», `data-sdg-unsupported`) и
 * `dead-load.ts` («страница не загрузилась», `data-sdg-dead-load`). Строка вшивается в начало КАЖДОГО IIFE
 * при сборке текста скрипта (`buildInlineScreenHelpers`), поэтому у скриптов нет общего глобального кода:
 * хелперы живут в замыкании своего IIFE, в `window` торчит только `__sdgDeadLoad` (см. ниже).
 *
 * Что внутри (все имена с префиксом `sdg`, чтобы не пересекаться с локальными `var` скриптов):
 *   - `CFG` — конфиг экрана, запечённый в скрипт при сборке: палитра (`CFG.theme.light`/`CFG.theme.dark`),
 *     тексты (`CFG.texts.*`) и, для скрипта «страница не загрузилась», таймаут watchdog'а
 *     (`CFG.loadTimeoutMs`). Значения приходят из опций модуля (`theme`, `texts`, `loadTimeoutMs`), а
 *     не из runtimeConfig: скрипт исполняется до старта приложения и читать runtimeConfig не может.
 *   - `doc`, `win` — `document`/`window`;
 *   - `sdgShared()` — общее состояние скриптов: объект `window.__sdgDeadLoad`. Его создаёт тот из скриптов,
 *     что исполнился первым (dead-load стоит в head, importmap-check — в bodyClose, то есть dead-load первый,
 *     но порядок не должен быть опорой). Поля: `fail`/`mounted`/`handled` — мост для клиентского плагина (их
 *     ставит dead-load, контракт — `dead-load-bridge.ts`; `handled()` — «документ уже пережил сбой»), `takenOver` —
 *     importmap-check показал экран «браузер устарел» и вызвал `window.stop()`: приложение не стартует, а `error`
 *     оборванных `window.stop()` скриптов entry не должны запускать повтор и второй экран;
 *   - `sdgEmit(name, detail)` — `CustomEvent` на window с фолбэком `createEvent('CustomEvent')` для браузеров
 *     без конструктора; не бросает;
 *   - `sdgTheme()` — палитра проекта: тёмная по умолчанию, светлая при `html.light` (класс @nuxtjs/color-mode)
 *     или, если на <html> нет `.dark`, при `prefers-color-scheme: light`. Считается в момент показа экрана,
 *     а не при старте скрипта: класс на <html> к этому времени уже выставлен;
 *   - `sdgAdd(parent, tag, css, text)` — `createElement` + `style.cssText` (CSSOM, CSP `style-src` его не
 *     блокирует) + `textContent` (не innerHTML);
 *   - `sdgOverlay(theme)` — fixed-оверлей на весь экран (`z-index: 2147483647`), `sdgCard(overlay)` — колонка
 *     по центру (max-width 420px), `sdgTitle`/`sdgText`/`sdgButton` — заголовок, абзац и кнопка в стиле
 *     экрана; `sdgShow(overlay)` — в `body`, а если его ещё нет (сбой пришёл, пока парсится head), в `<html>`.
 *
 * Почему СТРОКА, а не функция + `toString()`: текст обязан быть синтаксисом ES5 (`var`, `function`, без
 * стрелок/шаблонных строк/`?.`/`??`/spread), чтобы разобраться на ЛЮБОМ древнем браузере — парсинг-ошибка
 * молча убила бы экран. `toString()` отдал бы то, что выпустил сборщик (esnext), а не то, что написано.
 * `String.raw` — чтобы `\s` в regex'ах дошло до браузера как есть. В тексте нельзя: бэктики, `${`,
 * `</script`, `<!--` (ломают встраивание в HTML), поэтому и комментариев внутри нет — они выше. Единственные
 * `${...}` в исходнике — вшивание этой строки в скрипты; в итоговом тексте их нет.
 */

/** Конфиг, запекаемый в inline-скрипт: палитра, тексты и (для dead-load) таймаут watchdog'а. */
export interface InlineScreenConfig {
  /** Палитра проекта (тёмная/светлая). */
  theme: ResolvedScreenTheme
  /** Тексты экранов. */
  texts: ScreenTexts
  /** Таймаут watchdog'а «приложение не загрузилось» (мс). Только для скрипта dead-load. */
  loadTimeoutMs?: number
}

/*
 * Шаблон хелперов. `__SDG_CONFIG__` — место JSON-литерала с палитрой и текстами; заменяется при сборке
 * скрипта (`buildInlineScreenHelpers`). Замена — функцией, а не строкой: в JSON пользовательских текстов
 * могут встретиться `$&`/`$$` и т.п., которые `String.replace` иначе разобрал бы как спецпоследовательности.
 */
const INLINE_SCREEN_HELPERS_TEMPLATE = String.raw`  var CFG = __SDG_CONFIG__;
  var doc = document;
  var win = window;

  function sdgShared() {
    var shared = win.__sdgDeadLoad;
    if (!shared) {
      shared = {};
      win.__sdgDeadLoad = shared;
    }
    return shared;
  }

  function sdgEmit(name, detail) {
    try {
      var evt;
      try {
        evt = new CustomEvent(name, { detail: detail });
      } catch (e) {
        evt = doc.createEvent('CustomEvent');
        evt.initCustomEvent(name, false, false, detail);
      }
      win.dispatchEvent(evt);
    } catch (e) {}
  }

  function sdgTheme() {
    var root = doc.documentElement;
    var light = /(^|\s)light(\s|$)/.test(root.className);
    if (!light && !/(^|\s)dark(\s|$)/.test(root.className) && win.matchMedia) {
      light = win.matchMedia('(prefers-color-scheme: light)').matches;
    }
    var palette = light ? CFG.theme.light : CFG.theme.dark;
    return {
      bg: palette.bg,
      fg: palette.fg,
      muted: palette.muted,
      accent: palette.accent,
      onAccent: palette.onAccent,
      line: palette.line,
      fieldBg: palette.fieldBg
    };
  }

  function sdgAdd(parent, tag, css, text) {
    var node = doc.createElement(tag);
    node.style.cssText = css;
    if (text) {
      node.textContent = text;
    }
    parent.appendChild(node);
    return node;
  }

  function sdgOverlay(theme) {
    var node = doc.createElement('div');
    node.style.cssText =
      'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;display:flex;box-sizing:border-box;' +
      'padding:24px 20px;overflow:auto;-webkit-overflow-scrolling:touch;background:' + theme.bg + ';color:' + theme.fg + ';' +
      'font-family:Manrope,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.5';
    return node;
  }

  function sdgCard(overlay) {
    return sdgAdd(overlay, 'div', 'box-sizing:border-box;width:100%;max-width:420px;margin:auto');
  }

  function sdgTitle(card, theme, text) {
    return sdgAdd(card, 'h1', 'margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:' + theme.accent, text);
  }

  function sdgText(card, text) {
    return sdgAdd(card, 'p', 'margin:0 0 12px', text);
  }

  function sdgButton(card, theme, text) {
    var node = sdgAdd(
      card,
      'button',
      'display:block;width:100%;min-height:44px;margin:12px 0 0;padding:0 16px;border:0;border-radius:8px;' +
        '-webkit-appearance:none;appearance:none;background:' + theme.accent + ';color:' + theme.onAccent +
        ';font-family:inherit;font-size:16px;font-weight:600;cursor:pointer',
      text
    );
    node.type = 'button';
    return node;
  }

  function sdgShow(overlay) {
    (doc.body || doc.documentElement).appendChild(overlay);
  }
`

/** Хелперы inline-экранов с запечённой палитрой и текстами проекта. */
export function buildInlineScreenHelpers(config: InlineScreenConfig): string {
  return INLINE_SCREEN_HELPERS_TEMPLATE.replace('__SDG_CONFIG__', () => toInlineScriptLiteral(config))
}
