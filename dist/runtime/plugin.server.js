import { defineNuxtPlugin, useHead } from "#app";
import { SSR_MARKER_ATTR } from "./dead-load-bridge.js";
export default defineNuxtPlugin(() => {
  useHead({ htmlAttrs: { [SSR_MARKER_ATTR]: "" } });
});
