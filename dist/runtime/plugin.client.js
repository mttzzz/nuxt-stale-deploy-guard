import { defineNuxtPlugin, reloadNuxtApp, useRouter, useRuntimeConfig } from "#app";
import { createChunkReloadGuard } from "./chunk-reload-guard.js";
import { isStaleChunkError } from "./stale-chunk.js";
function getCurrentLocationPath() {
  return `${globalThis.location.pathname}${globalThis.location.search}`;
}
function makeFetchServerBuildId(headerName) {
  return async (path) => {
    const target = path || getCurrentLocationPath();
    const url = new URL(target, globalThis.location.origin).toString();
    const common = {
      cache: "no-store",
      credentials: "same-origin",
      headers: { "cache-control": "no-cache", "pragma": "no-cache" }
    };
    try {
      const response = await globalThis.fetch(url, { method: "HEAD", ...common });
      const id = response.headers.get(headerName)?.trim() ?? "";
      if (id) return id;
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
  const router = useRouter();
  const guard = createChunkReloadGuard({
    getBuildId: () => typeof config.app.buildId === "string" ? config.app.buildId : "",
    reload: () => reloadNuxtApp({ force: true, persistState: true }),
    fetchServerBuildId: makeFetchServerBuildId(opts.buildIdHeader),
    now: () => Date.now(),
    storage: sessionStorage,
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
    if (!isStaleChunkError(reason)) return;
    event.preventDefault();
    void guard.verifyAndReload();
  });
  globalThis.addEventListener("error", (event) => {
    const errorLike = event;
    const candidate = errorLike.error ?? errorLike.message;
    if (!isStaleChunkError(candidate)) return;
    event.preventDefault();
    void guard.verifyAndReload();
  });
  router.beforeEach((to, from) => {
    if (to.fullPath !== from.fullPath) {
      void guard.verifyAndReload(to.fullPath);
    }
  });
  nuxtApp.hook("app:mounted", () => {
    void guard.verifyAndReload(getCurrentLocationPath());
    globalThis.addEventListener("online", () => {
      void guard.verifyAndReload(getCurrentLocationPath());
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        void guard.verifyAndReload(getCurrentLocationPath());
      }
    });
    if (opts.pollIntervalMs > 0) {
      globalThis.setInterval(() => {
        void guard.verifyAndReload(getCurrentLocationPath());
      }, opts.pollIntervalMs);
    }
  });
});
