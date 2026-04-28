import { getHeader, getRequestURL, setHeader } from "h3";
import { defineNitroPlugin, useRuntimeConfig } from "nitropack/runtime";
const NO_STORE_HTML = "no-cache, no-store, must-revalidate";
function applyHeaders(event) {
  const config = useRuntimeConfig(event);
  const opts = config.public.staleDeployGuard;
  const buildId = typeof config.app.buildId === "string" ? config.app.buildId : "";
  if (buildId) {
    setHeader(event, opts.buildIdHeader, buildId);
  }
  const { pathname } = getRequestURL(event);
  const accept = getHeader(event, "accept") ?? "";
  if (pathname === opts.serviceWorkerPath || accept.includes("text/html")) {
    setHeader(event, "Cache-Control", NO_STORE_HTML);
  }
  if (pathname === opts.serviceWorkerPath) {
    setHeader(event, "Service-Worker-Allowed", "/");
  }
}
export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook("request", (event) => {
    applyHeaders(event);
  });
  nitroApp.hooks.hook("beforeResponse", (event) => {
    applyHeaders(event);
  });
});
