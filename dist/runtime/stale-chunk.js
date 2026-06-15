export const STALE_CHUNK_PATTERNS = [
  /Couldn't resolve component/iu,
  /Failed to fetch dynamically imported module/iu,
  /error loading dynamically imported module/iu,
  /Importing a module script failed/iu
];
export function isStaleChunkMessage(message) {
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message));
}
export const DEPLOY_NOISE_PATTERNS = [/Error fetching app manifest/iu];
export function isDeployNoiseMessage(message) {
  return DEPLOY_NOISE_PATTERNS.some((pattern) => pattern.test(message));
}
function extractErrorMessage(err) {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === "string") {
    return err;
  }
  if (typeof err === "object" && err !== null && "message" in err) {
    const { message } = err;
    if (typeof message === "string") {
      return message;
    }
  }
  return "";
}
export function isStaleChunkError(err) {
  return isStaleChunkMessage(extractErrorMessage(err));
}
