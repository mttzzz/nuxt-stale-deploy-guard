import { isStaleChunkError } from "./stale-chunk.js";
export const CHUNK_RELOAD_COOLDOWN_KEY = "chunk-reload:last-reload-at";
export const CHUNK_RELOAD_ATTEMPTS_KEY = "chunk-reload:attempts";
export const CHUNK_RELOAD_COOLDOWN_MS = 1e4;
export const CHUNK_RELOAD_CIRCUIT_WINDOW_MS = 5 * 60 * 1e3;
export const CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS = 3;
export const CHUNK_RELOAD_PROBES = 4;
export const CHUNK_RELOAD_PROBE_DELAY_MS = 400;
function defaultSleep(ms) {
  const { promise, resolve } = Promise.withResolvers();
  setTimeout(resolve, ms);
  return promise;
}
export function createChunkReloadGuard(deps) {
  let verifyInFlight = false;
  function inCooldown() {
    const raw = deps.storage.getItem(CHUNK_RELOAD_COOLDOWN_KEY);
    const last = raw ? Number(raw) : 0;
    return Number.isFinite(last) && deps.now() - last < CHUNK_RELOAD_COOLDOWN_MS;
  }
  function markReloadNow() {
    deps.storage.setItem(CHUNK_RELOAD_COOLDOWN_KEY, String(deps.now()));
  }
  function recordAttemptAndCount() {
    const now = deps.now();
    const raw = deps.storage.getItem(CHUNK_RELOAD_ATTEMPTS_KEY);
    let existing = [];
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          existing = parsed.filter((t) => typeof t === "number" && Number.isFinite(t));
        }
      } catch {
        existing = [];
      }
    }
    const fresh = existing.filter((t) => now - t < CHUNK_RELOAD_CIRCUIT_WINDOW_MS);
    fresh.push(now);
    deps.storage.setItem(CHUNK_RELOAD_ATTEMPTS_KEY, JSON.stringify(fresh));
    return fresh.length;
  }
  async function collectProbes(path, stopOnMismatch, currentBuildId) {
    const sleep = deps.sleep ?? defaultSleep;
    async function probe(attempt, seen) {
      let serverBuildId = "";
      try {
        serverBuildId = await deps.fetchServerBuildId(path, attempt);
      } catch {
        serverBuildId = "";
      }
      const collected = [...seen, serverBuildId];
      if (stopOnMismatch && serverBuildId && serverBuildId !== currentBuildId) {
        return collected;
      }
      if (attempt + 1 >= CHUNK_RELOAD_PROBES) {
        return collected;
      }
      await sleep(CHUNK_RELOAD_PROBE_DELAY_MS);
      return probe(attempt + 1, collected);
    }
    return probe(0, []);
  }
  async function verify(path, decide, stopOnMismatch) {
    const currentBuildId = deps.getBuildId();
    if (!currentBuildId) {
      return;
    }
    if (inCooldown()) {
      return;
    }
    if (verifyInFlight) {
      return;
    }
    verifyInFlight = true;
    try {
      const probes = await collectProbes(path, stopOnMismatch, currentBuildId);
      if (!decide(probes, currentBuildId)) {
        return;
      }
      const attempts = recordAttemptAndCount();
      if (attempts > CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS) {
        deps.dispatchBlocked({
          reason: "circuit-breaker",
          attempts,
          windowMs: CHUNK_RELOAD_CIRCUIT_WINDOW_MS
        });
        return;
      }
      markReloadNow();
      deps.reload();
    } finally {
      verifyInFlight = false;
    }
  }
  function verifyAndReload(path = "") {
    return verify(path, (probes, currentBuildId) => probes.some((id) => id !== "" && id !== currentBuildId), true);
  }
  function verifyConvergedAndReload(path = "") {
    return verify(
      path,
      (probes, currentBuildId) => {
        const [first] = probes;
        return Boolean(first) && first !== currentBuildId && probes.every((id) => id === first);
      },
      false
    );
  }
  function handleStaleChunkError(err, path = "") {
    if (isStaleChunkError(err)) {
      void verifyAndReload(path);
    }
  }
  return {
    verifyAndReload: (path) => verifyAndReload(path ?? ""),
    verifyConvergedAndReload: (path) => verifyConvergedAndReload(path ?? ""),
    handleStaleChunkError: (err, path) => {
      handleStaleChunkError(err, path ?? "");
    }
  };
}
