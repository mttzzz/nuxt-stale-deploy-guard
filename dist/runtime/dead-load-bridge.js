export const RETRY_MARKER_KEY = "sdg-retry";
export const DEAD_LOAD_GLOBAL = "__sdgDeadLoad";
function isDeadLoadBridge(value) {
  return typeof value === "object" && value !== null && "fail" in value && typeof value.fail === "function" && "mounted" in value && typeof value.mounted === "function";
}
export function readDeadLoadBridge() {
  const candidate = Reflect.get(globalThis, DEAD_LOAD_GLOBAL);
  return isDeadLoadBridge(candidate) ? candidate : void 0;
}
