export const RETRY_MARKER_KEY = "sdg-retry";
export const DEAD_LOAD_GLOBAL = "__sdgDeadLoad";
export const SSR_MARKER_ATTR = "data-sdg-ssr";
function isDeadLoadBridge(value) {
  return typeof value === "object" && value !== null && "fail" in value && typeof value.fail === "function" && "mounted" in value && typeof value.mounted === "function";
}
export function readDeadLoadBridge() {
  const candidate = Reflect.get(globalThis, DEAD_LOAD_GLOBAL);
  return isDeadLoadBridge(candidate) ? candidate : void 0;
}
export function isDeadLoadHandled(bridge) {
  const handled = bridge?.handled;
  if (typeof handled !== "function") {
    return false;
  }
  try {
    return handled();
  } catch {
    return false;
  }
}
