const PROBE_KEY = "__nuxt_stale_deploy_guard_probe__";
export function createSafeSessionStorage() {
  const memory = /* @__PURE__ */ new Map();
  let backend = null;
  try {
    const probe = globalThis.sessionStorage;
    if (probe) {
      probe.setItem(PROBE_KEY, "1");
      probe.removeItem(PROBE_KEY);
      backend = probe;
    }
  } catch {
    backend = null;
  }
  return {
    getItem(key) {
      if (backend) {
        try {
          return backend.getItem(key);
        } catch {
          backend = null;
        }
      }
      return memory.get(key) ?? null;
    },
    setItem(key, value) {
      memory.set(key, value);
      if (backend) {
        try {
          backend.setItem(key, value);
        } catch {
          backend = null;
        }
      }
    }
  };
}
