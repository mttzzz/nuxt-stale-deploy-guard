export const INLINE_SCREEN_HELPERS = String.raw`  var doc = document;
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
    return {
      bg: light ? '#ffffff' : '#1d161e',
      fg: light ? '#1d161e' : '#f3eef5',
      muted: light ? '#645369' : '#b9aabf',
      accent: light ? '#9333ea' : '#c084fc',
      onAccent: light ? '#ffffff' : '#1d161e',
      line: light ? '#d9cfe0' : '#4a3b50',
      fieldBg: light ? '#f6f2f8' : '#271d29'
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
`;
