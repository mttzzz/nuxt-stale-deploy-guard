export const DEFAULT_SCREEN_THEME = {
  dark: {
    bg: "#1d161e",
    fg: "#f3eef5",
    muted: "#b9aabf",
    accent: "#c084fc",
    onAccent: "#1d161e",
    line: "#4a3b50",
    fieldBg: "#271d29"
  },
  light: {
    bg: "#ffffff",
    fg: "#1d161e",
    muted: "#645369",
    accent: "#9333ea",
    onAccent: "#ffffff",
    line: "#d9cfe0",
    fieldBg: "#f6f2f8"
  }
};
export const DEFAULT_SCREEN_TEXTS = {
  unsupportedBrowserTitle: "\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u0443\u0441\u0442\u0430\u0440\u0435\u043B",
  unsupportedIosTitle: "\u0412\u0435\u0440\u0441\u0438\u044F iOS \u0443\u0441\u0442\u0430\u0440\u0435\u043B\u0430",
  unsupportedBrowserAdvice: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u0435 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u0438\u043B\u0438 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u044D\u0442\u0443 \u0441\u0441\u044B\u043B\u043A\u0443 \u0432 \u0434\u0440\u0443\u0433\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.",
  unsupportedIosAdvice: [
    "\u041D\u0443\u0436\u043D\u0430 iOS 16.4 \u0438\u043B\u0438 \u043D\u043E\u0432\u0435\u0435: \u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 \u2192 \u041E\u0441\u043D\u043E\u0432\u043D\u044B\u0435 \u2192 \u041E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u041F\u041E. \u0414\u0440\u0443\u0433\u043E\u0439 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u043D\u0430 \u044D\u0442\u043E\u043C \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0435 \u043D\u0435 \u043F\u043E\u043C\u043E\u0436\u0435\u0442.",
    "\u0415\u0441\u043B\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E, \u0441\u043A\u043E\u043F\u0438\u0440\u0443\u0439\u0442\u0435 \u0441\u0441\u044B\u043B\u043A\u0443 \u0438 \u043E\u0442\u043A\u0440\u043E\u0439\u0442\u0435 \u0435\u0451 \u043D\u0430 \u043A\u043E\u043C\u043F\u044C\u044E\u0442\u0435\u0440\u0435."
  ],
  urlFieldLabel: "\u0410\u0434\u0440\u0435\u0441 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u044B",
  copyLink: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443",
  linkCopied: "\u0421\u0441\u044B\u043B\u043A\u0430 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u0430",
  copyFailed: "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u2014 \u0432\u044B\u0434\u0435\u043B\u0438\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 \u0432\u0440\u0443\u0447\u043D\u0443\u044E",
  loading: "\u0417\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u043C \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443\u2026",
  failedTitle: "\u0421\u0442\u0440\u0430\u043D\u0438\u0446\u0430 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u043B\u0430\u0441\u044C",
  failedAdvice: "\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043A \u0438\u043D\u0442\u0435\u0440\u043D\u0435\u0442\u0443 \u0438 \u043D\u0430\u0436\u043C\u0438\u0442\u0435 \xAB\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C\xBB.",
  reload: "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"
};
export function resolveScreenTheme(option) {
  const dark = option?.dark;
  const light = option?.light;
  return {
    dark: {
      bg: dark?.bg ?? DEFAULT_SCREEN_THEME.dark.bg,
      fg: dark?.fg ?? DEFAULT_SCREEN_THEME.dark.fg,
      muted: dark?.muted ?? DEFAULT_SCREEN_THEME.dark.muted,
      accent: dark?.accent ?? DEFAULT_SCREEN_THEME.dark.accent,
      onAccent: dark?.onAccent ?? DEFAULT_SCREEN_THEME.dark.onAccent,
      line: dark?.line ?? DEFAULT_SCREEN_THEME.dark.line,
      fieldBg: dark?.fieldBg ?? DEFAULT_SCREEN_THEME.dark.fieldBg
    },
    light: {
      bg: light?.bg ?? DEFAULT_SCREEN_THEME.light.bg,
      fg: light?.fg ?? DEFAULT_SCREEN_THEME.light.fg,
      muted: light?.muted ?? DEFAULT_SCREEN_THEME.light.muted,
      accent: light?.accent ?? DEFAULT_SCREEN_THEME.light.accent,
      onAccent: light?.onAccent ?? DEFAULT_SCREEN_THEME.light.onAccent,
      line: light?.line ?? DEFAULT_SCREEN_THEME.light.line,
      fieldBg: light?.fieldBg ?? DEFAULT_SCREEN_THEME.light.fieldBg
    }
  };
}
export function resolveScreenTexts(option) {
  return {
    unsupportedBrowserTitle: option?.unsupportedBrowserTitle ?? DEFAULT_SCREEN_TEXTS.unsupportedBrowserTitle,
    unsupportedIosTitle: option?.unsupportedIosTitle ?? DEFAULT_SCREEN_TEXTS.unsupportedIosTitle,
    unsupportedBrowserAdvice: option?.unsupportedBrowserAdvice ?? DEFAULT_SCREEN_TEXTS.unsupportedBrowserAdvice,
    unsupportedIosAdvice: option?.unsupportedIosAdvice ? [...option.unsupportedIosAdvice] : [...DEFAULT_SCREEN_TEXTS.unsupportedIosAdvice],
    urlFieldLabel: option?.urlFieldLabel ?? DEFAULT_SCREEN_TEXTS.urlFieldLabel,
    copyLink: option?.copyLink ?? DEFAULT_SCREEN_TEXTS.copyLink,
    linkCopied: option?.linkCopied ?? DEFAULT_SCREEN_TEXTS.linkCopied,
    copyFailed: option?.copyFailed ?? DEFAULT_SCREEN_TEXTS.copyFailed,
    loading: option?.loading ?? DEFAULT_SCREEN_TEXTS.loading,
    failedTitle: option?.failedTitle ?? DEFAULT_SCREEN_TEXTS.failedTitle,
    failedAdvice: option?.failedAdvice ?? DEFAULT_SCREEN_TEXTS.failedAdvice,
    reload: option?.reload ?? DEFAULT_SCREEN_TEXTS.reload
  };
}
export function toInlineScriptLiteral(value) {
  return JSON.stringify(value).replaceAll(
    /[<>`$\u2028\u2029]/gu,
    (char) => `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, "0")}`
  );
}
