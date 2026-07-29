import { isStaleChunkError } from "./stale-chunk.js";
export const CHUNK_RELOAD_COOLDOWN_KEY = "chunk-reload:last-reload-at";
export const CHUNK_RELOAD_ATTEMPTS_KEY = "chunk-reload:attempts";
export const CHUNK_RELOAD_COOLDOWN_MS = 1e4;
export const CHUNK_RELOAD_CIRCUIT_WINDOW_MS = 5 * 60 * 1e3;
export const CHUNK_RELOAD_CIRCUIT_MAX_ATTEMPTS = 3;
export const CHUNK_RELOAD_PROBES = 4;
export const CHUNK_RELOAD_PROBE_DELAY_MS = 400;
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
  async function verifyAndReload(path = "") {
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
      const sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
      const probe = async (attempt) => {
        let serverBuildId = "";
        try {
          serverBuildId = await deps.fetchServerBuildId(path, attempt);
        } catch {
          serverBuildId = "";
        }
        if (serverBuildId && serverBuildId !== currentBuildId) {
          return serverBuildId;
        }
        if (attempt + 1 >= CHUNK_RELOAD_PROBES) {
          return "";
        }
        await sleep(CHUNK_RELOAD_PROBE_DELAY_MS);
        return probe(attempt + 1);
      };
      const mismatch = await probe(0);
      if (!mismatch) {
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
  function handleStaleChunkError(err, path = "") {
    if (isStaleChunkError(err)) {
      void verifyAndReload(path);
    }
  }
  return {
    verifyAndReload: (path) => verifyAndReload(path ?? ""),
    handleStaleChunkError: (err, path) => {
      handleStaleChunkError(err, path ?? "");
    }
  };
}
