import { defineNuxtPlugin, reloadNuxtApp, useRuntimeConfig } from "#app";
import { createChunkReloadGuard } from "./chunk-reload-guard.js";
import { createSafeSessionStorage } from "./safe-storage.js";
import { isStaleChunkError } from "./stale-chunk.js";
function getCurrentLocationPath() {
  return `${globalThis.location.pathname}${globalThis.location.search}`;
}
function makeFetchServerBuildId(headerName) {
  return async (path, attempt = 0) => {
    const target = path || getCurrentLocationPath();
    const probeUrl = new URL(target, globalThis.location.origin);
    probeUrl.searchParams.set("sdg-probe", `${Date.now()}-${attempt}`);
    const url = probeUrl.toString();
    const common = {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "cache-control": "no-cache", pragma: "no-cache" }
    };
    try {
      const response = await globalThis.fetch(url, { method: "HEAD", ...common });
      const id = response.headers.get(headerName)?.trim() ?? "";
      if (id) {
        return id;
      }
    } catch {
    }
    try {
      const response = await globalThis.fetch(url, {
        ...common,
        headers: { ...common.headers, accept: "text/html" }
      });
      return response.headers.get(headerName)?.trim() ?? "";
    } catch {
      return "";
    }
  };
}
export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();
  const opts = config.public.staleDeployGuard;
  const guard = createChunkReloadGuard({
    getBuildId: () => typeof config.app.buildId === "string" ? config.app.buildId : "",
    reload: () => {
      reloadNuxtApp({ force: true, persistState: true });
    },
    fetchServerBuildId: makeFetchServerBuildId(opts.buildIdHeader),
    now: () => Date.now(),
    /* `createSafeSessionStorage()` — wrapper, защищающий от SecurityError при
     * доступе к sessionStorage в restricted-браузерах (Telegram WebView и т.п.).
     * Раньше тут был прямой `sessionStorage`, который throw'ил синхронно при
     * инициализации плагина и валил публичные страницы консьюмеров (KP-MODMB-COM-K). */
    storage: createSafeSessionStorage(),
    dispatchBlocked: (detail) => {
      globalThis.dispatchEvent(new CustomEvent("app:chunk-reload-blocked", { detail }));
    }
  });
  nuxtApp.hook("app:chunkError", () => {
    void guard.verifyAndReload();
  });
  nuxtApp.hook("vue:error", (error) => {
    guard.handleStaleChunkError(error);
  });
  nuxtApp.hook("app:error", (error) => {
    guard.handleStaleChunkError(error);
  });
  globalThis.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    void guard.verifyAndReload();
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    const { reason } = event;
    if (!isStaleChunkError(reason)) {
      return;
    }
    event.preventDefault();
    void guard.verifyAndReload();
  });
  globalThis.addEventListener("error", (event) => {
    const errorLike = event;
    const candidate = errorLike.error ?? errorLike.message;
    if (!isStaleChunkError(candidate)) {
      return;
    }
    event.preventDefault();
    void guard.verifyAndReload();
  });
  if (opts.pollIntervalMs > 0) {
    nuxtApp.hook("app:mounted", () => {
      globalThis.setInterval(() => {
        void guard.verifyConvergedAndReload(getCurrentLocationPath());
      }, opts.pollIntervalMs);
    });
  }
});
