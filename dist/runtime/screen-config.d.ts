/** Палитра экрана: все поля обязательны (после резолва). */
export interface ScreenPalette {
    /** Фон оверлея. */
    bg: string;
    /** Основной текст. */
    fg: string;
    /** Приглушённый текст (подписи, заметки). */
    muted: string;
    /** Акцент: заголовок, кнопка. */
    accent: string;
    /** Текст на акценте (кнопка). */
    onAccent: string;
    /** Границы (поле с адресом). */
    line: string;
    /** Фон поля с адресом. */
    fieldBg: string;
}
/** Переопределение палитры: любое подмножество полей. */
export type ScreenPaletteOverride = Partial<ScreenPalette>;
/** Палитра проекта: отдельно тёмная и светлая. */
export interface ScreenThemeOption {
    dark?: ScreenPaletteOverride;
    light?: ScreenPaletteOverride;
}
/** Палитра после резолва: оба варианта заполнены целиком. */
export interface ResolvedScreenTheme {
    dark: ScreenPalette;
    light: ScreenPalette;
}
/** Все видимые строки inline-экранов. */
export interface ScreenTexts {
    /** Заголовок экрана «браузер без import maps» (не iOS). */
    unsupportedBrowserTitle: string;
    /** Заголовок экрана «браузер без import maps» (iOS). */
    unsupportedIosTitle: string;
    /** Подсказка экрана «браузер без import maps» (не iOS) — один абзац. */
    unsupportedBrowserAdvice: string;
    /** Подсказки экрана «браузер без import maps» (iOS) — по абзацу на строку. */
    unsupportedIosAdvice: string[];
    /** Подпись (aria-label) поля с адресом страницы. */
    urlFieldLabel: string;
    /** Кнопка копирования ссылки. */
    copyLink: string;
    /** Заметка после успешного копирования ссылки. */
    linkCopied: string;
    /** Заметка после неудачного копирования ссылки. */
    copyFailed: string;
    /** Оверлей во время автоповтора страницы. */
    loading: string;
    /** Заголовок экрана «страница не загрузилась». */
    failedTitle: string;
    /** Подсказка экрана «страница не загрузилась». */
    failedAdvice: string;
    /** Кнопка «Обновить» на экране «страница не загрузилась». */
    reload: string;
}
/** Переопределение текстов: любое подмножество полей. */
export type ScreenTextsOption = Partial<ScreenTexts>;
/** Палитра ai.pushka.biz — дефолт модуля (тёмная по умолчанию, светлая по `prefers-color-scheme`). */
export declare const DEFAULT_SCREEN_THEME: ResolvedScreenTheme;
/** Русские тексты ai.pushka.biz — дефолт модуля. */
export declare const DEFAULT_SCREEN_TEXTS: ScreenTexts;
/** Палитра проекта поверх дефолтов модуля: не задал поле — взяли дефолт. */
export declare function resolveScreenTheme(option?: ScreenThemeOption): ResolvedScreenTheme;
/** Тексты проекта поверх дефолтов модуля. */
export declare function resolveScreenTexts(option?: ScreenTextsOption): ScreenTexts;
export declare function toInlineScriptLiteral(value: unknown): string;
