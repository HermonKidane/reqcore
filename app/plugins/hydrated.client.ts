/**
 * Marks <html data-hydrated="1"> once the Nuxt app is interactive.
 * E2E tests wait for it before typing into forms: input typed into a not-yet-hydrated
 * form is wiped when Vue takes over, and a click then triggers the browser's native
 * "Please fill in this field".
 */
export default defineNuxtPlugin((nuxtApp) => {
  nuxtApp.hook('app:suspense:resolve', () => {
    document.documentElement.dataset.hydrated = '1'
  })
})
