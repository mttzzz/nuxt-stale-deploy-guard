import { INLINE_SCREEN_HELPERS } from "./inline-screen.js";
export const IMPORTMAP_CHECK_SCRIPT_KEY = "stale-deploy-guard-importmap-check";
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
})();`;
