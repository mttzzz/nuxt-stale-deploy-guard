export const IMPORTMAP_CHECK_SCRIPT_KEY = "stale-deploy-guard-importmap-check";
export const IMPORTMAP_CHECK_SCRIPT = String.raw`(function () {
  var doc = document;
  var win = window;
  if (!doc.querySelector('script[type="importmap"]')) {
    return;
  }
  var Script = win.HTMLScriptElement;
  if (Script && typeof Script.supports === 'function' && Script.supports('importmap') === true) {
    return;
  }

  var EVENT_NAME = 'app:chunk-reload-blocked';
  var detail = { reason: 'unsupported-browser', missing: 'importmap' };
  try {
    if (win.stop) {
      win.stop();
    }
  } catch (e) {}
  try {
    var evt;
    try {
      evt = new CustomEvent(EVENT_NAME, { detail: detail });
    } catch (e) {
      evt = doc.createEvent('CustomEvent');
      evt.initCustomEvent(EVENT_NAME, false, false, detail);
    }
    win.dispatchEvent(evt);
  } catch (e) {}

  var ua = navigator.userAgent || '';
  var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  var root = doc.documentElement;
  var light = /(^|\s)light(\s|$)/.test(root.className);
  if (!light && !/(^|\s)dark(\s|$)/.test(root.className) && win.matchMedia) {
    light = win.matchMedia('(prefers-color-scheme: light)').matches;
  }
  var bg = light ? '#ffffff' : '#1d161e';
  var fg = light ? '#1d161e' : '#f3eef5';
  var muted = light ? '#645369' : '#b9aabf';
  var accent = light ? '#9333ea' : '#c084fc';
  var onAccent = light ? '#ffffff' : '#1d161e';
  var line = light ? '#d9cfe0' : '#4a3b50';
  var fieldBg = light ? '#f6f2f8' : '#271d29';

  function add(parent, tag, css, text) {
    var node = doc.createElement(tag);
    node.style.cssText = css;
    if (text) {
      node.textContent = text;
    }
    parent.appendChild(node);
    return node;
  }

  var overlay = doc.createElement('div');
  overlay.setAttribute('data-sdg-unsupported', '');
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'sdg-importmap-title');
  overlay.style.cssText =
    'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;display:flex;box-sizing:border-box;' +
    'padding:24px 20px;overflow:auto;-webkit-overflow-scrolling:touch;background:' + bg + ';color:' + fg + ';' +
    'font-family:Manrope,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;font-size:16px;line-height:1.5';
  var card = add(overlay, 'div', 'box-sizing:border-box;width:100%;max-width:420px;margin:auto');
  var title = add(
    card,
    'h1',
    'margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:700;color:' + accent,
    ios ? 'Версия iOS устарела' : 'Браузер устарел'
  );
  title.id = 'sdg-importmap-title';
  var paragraphs = ios
    ? [
        'Нужна iOS 16.4 или новее: Настройки → Основные → Обновление ПО. Другой браузер на этом устройстве не поможет.',
        'Если обновление недоступно, скопируйте ссылку и откройте её на компьютере.'
      ]
    : ['Обновите браузер или откройте эту ссылку в другом браузере.'];
  for (var i = 0; i < paragraphs.length; i++) {
    add(card, 'p', 'margin:0 0 12px', paragraphs[i]);
  }
  var field = add(
    card,
    'input',
    'display:block;box-sizing:border-box;width:100%;margin:16px 0 0;padding:10px 12px;border:1px solid ' + line +
      ';border-radius:8px;-webkit-appearance:none;appearance:none;background:' + fieldBg + ';color:' + fg +
      ';font-family:inherit;font-size:16px;line-height:1.4'
  );
  field.type = 'text';
  field.readOnly = true;
  field.value = win.location.href;
  field.setAttribute('aria-label', 'Адрес страницы');
  var button = add(
    card,
    'button',
    'display:block;width:100%;min-height:44px;margin:12px 0 0;padding:0 16px;border:0;border-radius:8px;' +
      '-webkit-appearance:none;appearance:none;background:' + accent + ';color:' + onAccent +
      ';font-family:inherit;font-size:16px;font-weight:600;cursor:pointer',
    'Скопировать ссылку'
  );
  button.type = 'button';
  var note = add(card, 'p', 'margin:12px 0 0;min-height:1.5em;font-size:14px;color:' + muted);
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

  (doc.body || root).appendChild(overlay);
})();`;
