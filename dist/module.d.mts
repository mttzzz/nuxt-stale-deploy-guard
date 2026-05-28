import * as _nuxt_schema from '@nuxt/schema';
import { ResolvedModuleOptions, ModuleOptions } from '../dist/runtime/types.js';
export { ModuleOptions } from '../dist/runtime/types.js';

declare function shouldEnableClientGuard(opts: ResolvedModuleOptions, isDev: boolean): boolean;
declare const _default: _nuxt_schema.NuxtModule<ModuleOptions, ModuleOptions, false>;

declare module 'nuxt/schema' {
    interface RuntimeConfig {
        public: RuntimeConfig['public'] & {
            staleDeployGuard?: ResolvedModuleOptions;
        };
    }
}

export { _default as default, shouldEnableClientGuard };
