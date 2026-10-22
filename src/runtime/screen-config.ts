/*
 * Палитра и тексты inline-экранов модуля: «браузер без import maps» (importmap-check.ts) и «страница не
 * загрузилась» (dead-load.ts). Раньше палитра ai.pushka.biz и русские строки были зашиты в тела скриптов —
 * каждому консьюмеру нужна своя палитра («в каждом проекте своя палитра»), а тексты у kp свои. Теперь это
 * опции модуля (`theme`, `texts`), а дефолты — здесь: проект, который ничего не переопределяет, получает
 * ровно ту же картинку, что и раньше (пиксель в пиксель).
 *
 * Палитра покрывает ровно те поля, которые отдавал `sdgTheme()`: `bg`, `fg`, `muted`, `accent`, `onAccent`,
 * `line`, `fieldBg` — в двух вариантах (тёмный по умолчанию, светлый при `html.light` или
 * `prefers-color-scheme: light`). Любое поле переопределяется по отдельности: не задал — взяли дефолт.
 *
 * Тексты — все видимые строки обоих экранов (заголовки, подсказки, кнопки, aria-label поля с адресом,
 * сообщения после копирования ссылки). `unsupportedIosAdvice` — массив абзацев: пользовательский массив
 * ЗАМЕНЯЕТ дефолтный (не дополняет его), иначе к каждому абзацу добавился бы дефолтный.
 *
 * Всё это попадает в inline-скрипт как JSON-литерал (см. `toInlineScriptLiteral`): скрипт исполняется до
 * старта приложения и не читает runtimeConfig, поэтому значения запекаются на этапе сборки.
 */

/** Палитра экрана: все поля обязательны (после резолва). */
export interface ScreenPalette {
  /** Фон оверлея. */
  bg: string
  /** Основной текст. */
  fg: string
  /** Приглушённый текст (подписи, заметки). */
  muted: string
  /** Акцент: заголовок, кнопка. */
  accent: string
  /** Текст на акценте (кнопка). */
  onAccent: string
  /** Границы (поле с адресом). */
  line: string
  /** Фон поля с адресом. */
  fieldBg: string
}

/** Переопределение палитры: любое подмножество полей. */
export type ScreenPaletteOverride = Partial<ScreenPalette>

/** Палитра проекта: отдельно тёмная и светлая. */
export interface ScreenThemeOption {
  dark?: ScreenPaletteOverride
  light?: ScreenPaletteOverride
}

/** Палитра после резолва: оба варианта заполнены целиком. */
export interface ResolvedScreenTheme {
  dark: ScreenPalette
  light: ScreenPalette
}

/** Все видимые строки inline-экранов. */
export interface ScreenTexts {
  /** Заголовок экрана «браузер без import maps» (не iOS). */
  unsupportedBrowserTitle: string
  /** Заголовок экрана «браузер без import maps» (iOS). */
  unsupportedIosTitle: string
  /** Подсказка экрана «браузер без import maps» (не iOS) — один абзац. */
  unsupportedBrowserAdvice: string
  /** Подсказки экрана «браузер без import maps» (iOS) — по абзацу на строку. */
  unsupportedIosAdvice: string[]
  /** Подпись (aria-label) поля с адресом страницы. */
  urlFieldLabel: string
  /** Кнопка копирования ссылки. */
  copyLink: string
  /** Заметка после успешного копирования ссылки. */
  linkCopied: string
  /** Заметка после неудачного копирования ссылки. */
  copyFailed: string
  /** Оверлей во время автоповтора страницы. */
  loading: string
  /** Заголовок экрана «страница не загрузилась». */
  failedTitle: string
  /** Подсказка экрана «страница не загрузилась». */
  failedAdvice: string
  /** Кнопка «Обновить» на экране «страница не загрузилась». */
  reload: string
}

/** Переопределение текстов: любое подмножество полей. */
export type ScreenTextsOption = Partial<ScreenTexts>

/** Палитра ai.pushka.biz — дефолт модуля (тёмная по умолчанию, светлая по `prefers-color-scheme`). */
export const DEFAULT_SCREEN_THEME: ResolvedScreenTheme = {
  dark: {
    bg: '#1d161e',
    fg: '#f3eef5',
    muted: '#b9aabf',
    accent: '#c084fc',
    onAccent: '#1d161e',
    line: '#4a3b50',
    fieldBg: '#271d29',
  },
  light: {
    bg: '#ffffff',
    fg: '#1d161e',
    muted: '#645369',
    accent: '#9333ea',
    onAccent: '#ffffff',
    line: '#d9cfe0',
    fieldBg: '#f6f2f8',
  },
}

/** Русские тексты ai.pushka.biz — дефолт модуля. */
export const DEFAULT_SCREEN_TEXTS: ScreenTexts = {
  unsupportedBrowserTitle: 'Браузер устарел',
  unsupportedIosTitle: 'Версия iOS устарела',
  unsupportedBrowserAdvice: 'Обновите браузер или откройте эту ссылку в другом браузере.',
  unsupportedIosAdvice: [
    'Нужна iOS 16.4 или новее: Настройки → Основные → Обновление ПО. Другой браузер на этом устройстве не поможет.',
    'Если обновление недоступно, скопируйте ссылку и откройте её на компьютере.',
  ],
  urlFieldLabel: 'Адрес страницы',
  copyLink: 'Скопировать ссылку',
  linkCopied: 'Ссылка скопирована',
  copyFailed: 'Не удалось скопировать — выделите адрес вручную',
  loading: 'Загружаем страницу…',
  failedTitle: 'Страница не загрузилась',
  failedAdvice: 'Проверьте подключение к интернету и нажмите «Обновить».',
  reload: 'Обновить',
}

/** Палитра проекта поверх дефолтов модуля: не задал поле — взяли дефолт. */
export function resolveScreenTheme(option?: ScreenThemeOption): ResolvedScreenTheme {
  const dark = option?.dark
  const light = option?.light
  return {
    dark: {
      bg: dark?.bg ?? DEFAULT_SCREEN_THEME.dark.bg,
      fg: dark?.fg ?? DEFAULT_SCREEN_THEME.dark.fg,
      muted: dark?.muted ?? DEFAULT_SCREEN_THEME.dark.muted,
      accent: dark?.accent ?? DEFAULT_SCREEN_THEME.dark.accent,
      onAccent: dark?.onAccent ?? DEFAULT_SCREEN_THEME.dark.onAccent,
      line: dark?.line ?? DEFAULT_SCREEN_THEME.dark.line,
      fieldBg: dark?.fieldBg ?? DEFAULT_SCREEN_THEME.dark.fieldBg,
    },
    light: {
      bg: light?.bg ?? DEFAULT_SCREEN_THEME.light.bg,
      fg: light?.fg ?? DEFAULT_SCREEN_THEME.light.fg,
      muted: light?.muted ?? DEFAULT_SCREEN_THEME.light.muted,
      accent: light?.accent ?? DEFAULT_SCREEN_THEME.light.accent,
      onAccent: light?.onAccent ?? DEFAULT_SCREEN_THEME.light.onAccent,
      line: light?.line ?? DEFAULT_SCREEN_THEME.light.line,
      fieldBg: light?.fieldBg ?? DEFAULT_SCREEN_THEME.light.fieldBg,
    },
  }
}

/** Тексты проекта поверх дефолтов модуля. */
export function resolveScreenTexts(option?: ScreenTextsOption): ScreenTexts {
  return {
    unsupportedBrowserTitle: option?.unsupportedBrowserTitle ?? DEFAULT_SCREEN_TEXTS.unsupportedBrowserTitle,
    unsupportedIosTitle: option?.unsupportedIosTitle ?? DEFAULT_SCREEN_TEXTS.unsupportedIosTitle,
    unsupportedBrowserAdvice: option?.unsupportedBrowserAdvice ?? DEFAULT_SCREEN_TEXTS.unsupportedBrowserAdvice,
    unsupportedIosAdvice: option?.unsupportedIosAdvice
      ? [...option.unsupportedIosAdvice]
      : [...DEFAULT_SCREEN_TEXTS.unsupportedIosAdvice],
    urlFieldLabel: option?.urlFieldLabel ?? DEFAULT_SCREEN_TEXTS.urlFieldLabel,
    copyLink: option?.copyLink ?? DEFAULT_SCREEN_TEXTS.copyLink,
    linkCopied: option?.linkCopied ?? DEFAULT_SCREEN_TEXTS.linkCopied,
    copyFailed: option?.copyFailed ?? DEFAULT_SCREEN_TEXTS.copyFailed,
    loading: option?.loading ?? DEFAULT_SCREEN_TEXTS.loading,
    failedTitle: option?.failedTitle ?? DEFAULT_SCREEN_TEXTS.failedTitle,
    failedAdvice: option?.failedAdvice ?? DEFAULT_SCREEN_TEXTS.failedAdvice,
    reload: option?.reload ?? DEFAULT_SCREEN_TEXTS.reload,
  }
}

/*
 * JSON → JS-литерал для inline <script>. Экранируем `<` (чтобы значение не могло закрыть тег `</script`
 * или начать `<!--`), U+2028/U+2029 (в строковом литерале ES5 это синтаксическая ошибка), а также
 * обратную кавычку и `$` — по правилам текста inline-скриптов модуля (никаких бэктиков и `${` в HTML).
 * Значения приходят из конфига проекта, поэтому экранирование обязательно.
 */
export function toInlineScriptLiteral(value: unknown): string {
  return JSON.stringify(value).replaceAll(
    /[<>`$\u2028\u2029]/gu,
    (char) => `\\u${(char.codePointAt(0) ?? 0).toString(16).padStart(4, '0')}`,
  )
}
