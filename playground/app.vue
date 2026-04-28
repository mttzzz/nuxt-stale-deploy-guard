<script setup lang="ts">
const { data } = await useFetch('/api/foo')
const config = useRuntimeConfig()

function triggerVitePreloadError() {
  globalThis.dispatchEvent(
    new CustomEvent('vite:preloadError', {
      detail: new Error('Failed to fetch dynamically imported module'),
    }),
  )
}
</script>

<template>
  <div style="font-family: system-ui; padding: 2rem; max-width: 720px; margin: 0 auto">
    <h1>stale-deploy-guard playground</h1>
    <p>buildId: <code>{{ config.app.buildId }}</code></p>
    <p>API response: <pre>{{ data }}</pre></p>
    <button
      type="button"
      @click="triggerVitePreloadError"
    >
      Trigger vite:preloadError
    </button>
    <p style="opacity: 0.7; margin-top: 2rem; font-size: 0.9em">
      В DevTools Network проверь Cache-Control на <code>/</code>, <code>/_nuxt/&lt;hash&gt;.js</code>,
      <code>/api/foo</code>. Все ответы должны нести <code>x-app-build-id</code>.
    </p>
  </div>
</template>
