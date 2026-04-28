export const STALE_CHUNK_PATTERNS = [
  /Couldn't resolve component/i,
  /Failed to fetch dynamically imported module/i,
  /error loading dynamically imported module/i,
  /Importing a module script failed/i
];
export function isStaleChunkMessage(message) {
  return STALE_CHUNK_PATTERNS.some((pattern) => pattern.test(message));
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
