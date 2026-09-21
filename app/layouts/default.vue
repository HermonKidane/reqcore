<script setup lang="ts">
const route = useRoute()

const isBlogRoute = computed(() => /^\/blog(?:\/|$)/.test(route.path))
</script>

<template>
  <div class="layout-default">
    <div v-if="!isBlogRoute" class="fixed left-3 bottom-3 z-[60]">
      <LanguageSwitcher open-up />
    </div>
    <slot />
  </div>
</template>
