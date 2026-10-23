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
  var TICK_MS = 1000;
  var TICK_CAP_MS = TICK_MS * 2;
  var PENDING_LIMIT = 5;
  var ERRORS_LIMIT = 3;
  var PATH_LIMIT = 120;
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
      describeLoad(detail);
    } catch (e) {}
    sdgEmit('app:load-timeout', detail);
  }

  function describeLoad(detail) {
    var scan = scanCritical();
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
      return String(node.type).toLowerCase() === 'module' || !(node.async || node.hasAttribute('async'));
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
    var scan = { criticalCount: 0, pending: [], pendingCount: 0, firstHost: '' };
    try {
      var loaded = loadedResources();
      var nodes = doc.querySelectorAll('link[href], script[src]');
      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];
        if (!isCritical(node)) {
          continue;
        }
        scan.criticalCount++;
        var url = /^script$/i.test(node.tagName) ? node.src : node.href;
        if (loaded === null || loaded[url] === true) {
          continue;
        }
        scan.pendingCount++;
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
})();`;
}
export const DEAD_LOAD_SCRIPT = buildDeadLoadScript();
