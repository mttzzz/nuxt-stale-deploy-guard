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
`;
