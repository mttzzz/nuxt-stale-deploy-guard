import { defineNuxtPlugin, reloadNuxtApp, useRouter, useRuntimeConfig } from "#app";
import { createChunkReloadGuard } from "./chunk-reload-guard.js";
import { isDeadLoadHandled, readDeadLoadBridge, RETRY_MARKER_KEY } from "./dead-load-bridge.js";
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
  const router = useRouter();
  const deadLoad = readDeadLoadBridge();
  let mounted = false;
  const guard = createChunkReloadGuard({
    getBuildId: () => typeof config.app.buildId === "string" ? config.app.buildId : "",
    reload: (path) => {
      reloadNuxtApp(
        path === void 0 ? { force: true, persistState: true } : { path, force: true, persistState: true }
      );
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
  function handOverBeforeMount(error) {
    if (!deadLoad || mounted) {
      return false;
    }
    deadLoad.fail("chunk", error);
    return true;
  }
  function deadLoadHandled() {
    return isDeadLoadHandled(deadLoad);
  }
  async function dropRetryMarker() {
    const route = router.currentRoute.value;
    if (!(RETRY_MARKER_KEY in route.query)) {
      return;
    }
    const query = Object.fromEntries(Object.entries(route.query).filter(([key]) => key !== RETRY_MARKER_KEY));
    try {
      await router.replace({ path: route.path, query, hash: route.hash });
    } catch {
    }
  }
  nuxtApp.hook("app:chunkError", ({ error }) => {
    if (deadLoadHandled()) {
      return;
    }
    if (handOverBeforeMount(error)) {
      return;
    }
    void guard.verifyAndReload(void 0, error);
  });
  nuxtApp.hook("vue:error", (error) => {
    if (deadLoadHandled()) {
      return;
    }
    if (isStaleChunkError(error) && handOverBeforeMount(error)) {
      return;
    }
    guard.handleStaleChunkError(error);
  });
  nuxtApp.hook("app:error", (error) => {
    if (deadLoadHandled()) {
      return;
    }
    if (isStaleChunkError(error) && handOverBeforeMount(error)) {
      return;
    }
    guard.handleStaleChunkError(error);
  });
  router.onError((error, to) => {
    if (deadLoadHandled() || !isStaleChunkError(error)) {
      return;
    }
    if (handOverBeforeMount(error)) {
      return;
    }
    guard.handleFailedNavigation(error, `${config.app.baseURL.replace(/\/+$/u, "")}${to.fullPath}`);
  });
  nuxtApp.hook("app:mounted", () => {
    mounted = true;
    if (!deadLoad) {
      return;
    }
    if (deadLoadHandled()) {
      return;
    }
    deadLoad.mounted();
    void dropRetryMarker();
  });
  globalThis.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    const error = "payload" in event ? event.payload : void 0;
    if (deadLoadHandled()) {
      return;
    }
    if (handOverBeforeMount(error)) {
      return;
    }
    void guard.verifyAndReload(void 0, error);
  });
  globalThis.addEventListener("unhandledrejection", (event) => {
    const { reason } = event;
    if (!isStaleChunkError(reason)) {
      return;
    }
    event.preventDefault();
    if (deadLoadHandled()) {
      return;
    }
    if (handOverBeforeMount(reason)) {
      return;
    }
    void guard.verifyAndReload(void 0, reason);
  });
  globalThis.addEventListener("error", (event) => {
    const errorLike = event;
    const candidate = errorLike.error ?? errorLike.message;
    if (!isStaleChunkError(candidate)) {
      return;
    }
    event.preventDefault();
    if (deadLoadHandled()) {
      return;
    }
    if (handOverBeforeMount(candidate)) {
      return;
    }
    void guard.verifyAndReload(void 0, candidate);
  });
  if (opts.pollIntervalMs > 0) {
    nuxtApp.hook("app:mounted", () => {
      globalThis.setInterval(() => {
        if (deadLoadHandled()) {
          return;
        }
        void guard.verifyConvergedAndReload(getCurrentLocationPath());
      }, opts.pollIntervalMs);
    });
  }
});
