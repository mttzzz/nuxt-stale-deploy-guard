import { isStaleChunkError, isStaleChunkMessage, STALE_CHUNK_PATTERNS } from "./stale-chunk.js";
export { isStaleChunkError, isStaleChunkMessage, STALE_CHUNK_PATTERNS };
const DEFAULT_BREADCRUMB_WINDOW_MS = 5e3;
export function hasRecentStaleChunkBreadcrumb(event, opts = {}) {
  const breadcrumbs = event.breadcrumbs;
  if (!breadcrumbs || breadcrumbs.length === 0) {
    return false;
  }
  const windowMs = opts.windowMs ?? DEFAULT_BREADCRUMB_WINDOW_MS;
  const eventTimeMs = typeof event.timestamp === "number" ? event.timestamp * 1e3 : opts.now ?? Date.now();
  return breadcrumbs.some((crumb) => crumbMatches(crumb, eventTimeMs, windowMs));
}
function crumbMatches(crumb, eventTimeMs, windowMs) {
  if (typeof crumb.timestamp !== "number") return false;
  const crumbTimeMs = crumb.timestamp * 1e3;
  const delta = eventTimeMs - crumbTimeMs;
  if (delta < 0 || delta > windowMs) return false;
  if (crumb.category !== "console" || crumb.level !== "error") return false;
  if (crumb.message && isStaleChunkMessage(crumb.message)) return true;
  const args = crumb.data?.arguments;
  if (!Array.isArray(args)) return false;
  return args.some((arg) => {
    if (typeof arg === "string") return isStaleChunkMessage(arg);
    if (typeof arg === "object" && arg !== null && "message" in arg) {
      const { message } = arg;
      if (typeof message === "string") return isStaleChunkMessage(message);
    }
    return false;
  });
}
export function createSentryStaleChunkFilter(opts = {}) {
  return (event) => hasRecentStaleChunkBreadcrumb(event, opts) ? null : event;
}
