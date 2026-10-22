import { type InlineScreenConfig } from './inline-screen.js';
export declare const DEAD_LOAD_SCRIPT_KEY = "stale-deploy-guard-dead-load";
export declare const DEAD_LOAD_SCRIPT_PRIORITY = -1;
export declare const DEFAULT_LOAD_TIMEOUT_MS = 45000;
/** Текст inline-скрипта «мёртвая первая загрузка» с палитрой, текстами и таймаутом watchdog'а проекта. */
export declare function buildDeadLoadScript(config?: InlineScreenConfig): string;
export declare const DEAD_LOAD_SCRIPT: string;
