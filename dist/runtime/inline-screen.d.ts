import { type ResolvedScreenTheme, type ScreenTexts } from './screen-config.js';
/** Конфиг, запекаемый в inline-скрипт: палитра, тексты и (для dead-load) таймаут watchdog'а. */
export interface InlineScreenConfig {
    /** Палитра проекта (тёмная/светлая). */
    theme: ResolvedScreenTheme;
    /** Тексты экранов. */
    texts: ScreenTexts;
    /** Таймаут watchdog'а «приложение не загрузилось» (мс). Только для скрипта dead-load. */
    loadTimeoutMs?: number;
}
/** Хелперы inline-экранов с запечённой палитрой и текстами проекта. */
export declare function buildInlineScreenHelpers(config: InlineScreenConfig): string;
