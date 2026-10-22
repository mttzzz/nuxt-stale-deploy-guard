import { type InlineScreenConfig } from './inline-screen.js';
export declare const IMPORTMAP_CHECK_SCRIPT_KEY = "stale-deploy-guard-importmap-check";
/** Текст inline-скрипта проверки import maps с палитрой и текстами проекта. */
export declare function buildImportmapCheckScript(config?: InlineScreenConfig): string;
export declare const IMPORTMAP_CHECK_SCRIPT: string;
