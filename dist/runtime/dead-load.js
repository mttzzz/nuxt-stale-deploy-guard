import { buildInlineScreenHelpers } from "./inline-screen.js";
import { DEFAULT_SCREEN_THEME, DEFAULT_SCREEN_TEXTS } from "./screen-config.js";
export const DEAD_LOAD_SCRIPT_KEY = "stale-deploy-guard-dead-load";
export const DEAD_LOAD_SCRIPT_PRIORITY = -1;
export const DEFAULT_LOAD_TIMEOUT_MS = 45e3;
const DEFAULT_CONFIG = {
  theme: DEFAULT_SCREEN_THEME,
  texts: DEFAULT_SCREEN_TEXTS,
  loadTimeoutMs: DEFAULT_LOAD_TIMEOUT_MS
};
export function buildDeadLoadScript(config = DEFAULT_CONFIG) {
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
})();`;
}
export const DEAD_LOAD_SCRIPT = buildDeadLoadScript();
