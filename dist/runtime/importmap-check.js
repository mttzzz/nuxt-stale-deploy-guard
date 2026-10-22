import { buildInlineScreenHelpers } from "./inline-screen.js";
import { DEFAULT_SCREEN_THEME, DEFAULT_SCREEN_TEXTS } from "./screen-config.js";
export const IMPORTMAP_CHECK_SCRIPT_KEY = "stale-deploy-guard-importmap-check";
const DEFAULT_CONFIG = {
  theme: DEFAULT_SCREEN_THEME,
  texts: DEFAULT_SCREEN_TEXTS
};
export function buildImportmapCheckScript(config = DEFAULT_CONFIG) {
  return String.raw`(function () {
${buildInlineScreenHelpers(config)}
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
  var title = sdgTitle(card, theme, ios ? CFG.texts.unsupportedIosTitle : CFG.texts.unsupportedBrowserTitle);
  title.id = 'sdg-importmap-title';
  var paragraphs = ios
    ? CFG.texts.unsupportedIosAdvice
    : [CFG.texts.unsupportedBrowserAdvice];
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
  field.setAttribute('aria-label', CFG.texts.urlFieldLabel);
  var button = sdgButton(card, theme, CFG.texts.copyLink);
  var note = sdgAdd(card, 'p', 'margin:12px 0 0;min-height:1.5em;font-size:14px;color:' + theme.muted);
  note.setAttribute('aria-live', 'polite');

  function report(copied) {
    note.textContent = copied ? CFG.texts.linkCopied : CFG.texts.copyFailed;
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
}
export const IMPORTMAP_CHECK_SCRIPT = buildImportmapCheckScript();
