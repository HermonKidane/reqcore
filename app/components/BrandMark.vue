<script setup lang="ts">
/**
 * MyRecruiter mark: two people (candidate + client) whose inner legs cross to form an "M".
 * `animated` plays the once-on-load "walk in and merge" micro-interaction (1.2 s, ease-in-out,
 * then a 0.5 s highlight sweep). Respects prefers-reduced-motion (final state shown immediately).
 */
const props = withDefaults(defineProps<{
  /** Pixel size (square). */
  size?: number
  /** Play the merge animation once on mount. */
  animated?: boolean
  /** Change this value to replay the animation. */
  replayKey?: number
}>(), { size: 64, animated: false, replayKey: 0 })

// Unique gradient ids so several marks on one page don't collide.
const uid = useId()
const id = (name: string) => `${uid}-${name}`

const LEFT_BODY = 'M5.32 106.38V72.08A28.66 28.66 0 0 1 59.09 58.25L76.44 89.72A14.21 14.21 0 0 1 51.56 103.45L36.37 75.9A1.4 1.4 0 0 0 33.74 76.57V106.38A14.21 14.21 0 0 1 5.32 106.38Z'
const RIGHT_BODY = 'M122.68 106.38V72.08A28.66 28.66 0 0 0 68.91 58.25L51.56 89.72A14.21 14.21 0 0 0 76.44 103.45L91.63 75.9A1.4 1.4 0 0 1 94.26 76.57V106.38A14.21 14.21 0 0 0 122.68 106.38Z'
</script>

<template>
  <svg
    :key="props.replayKey"
    :width="props.size"
    :height="props.size"
    viewBox="0 0 128 128"
    role="img"
    aria-label="MyRecruiter"
    class="brand-mark"
    :class="{ 'brand-mark--animated': props.animated }"
  >
    <defs>
      <linearGradient :id="id('left')" x1="8" y1="8" x2="80" y2="118" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#6A97FA" />
        <stop offset="1" stop-color="#5A88F4" />
      </linearGradient>
      <linearGradient :id="id('right-head')" x1="78" y1="8" x2="110" y2="40" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#5584EA" />
        <stop offset="1" stop-color="#4C79DE" />
      </linearGradient>
      <linearGradient :id="id('right')" x1="112" y1="44" x2="56" y2="110" gradientUnits="userSpaceOnUse">
        <stop offset="0" stop-color="#5383E9" />
        <stop offset=".55" stop-color="#4F7CE0" />
        <stop offset="1" stop-color="#4671D8" />
      </linearGradient>
      <linearGradient :id="id('sheen')" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#fff" stop-opacity="0" />
        <stop offset=".5" stop-color="#fff" stop-opacity=".42" />
        <stop offset="1" stop-color="#fff" stop-opacity="0" />
      </linearGradient>
      <clipPath :id="id('clip-left')">
        <path :d="LEFT_BODY" />
      </clipPath>
      <mask :id="id('mask')" maskUnits="userSpaceOnUse" x="0" y="0" width="128" height="128">
        <g fill="#fff">
          <circle cx="33.74" cy="24.31" r="16.91" />
          <circle cx="94.26" cy="24.31" r="16.91" />
          <path :d="LEFT_BODY" />
          <path :d="RIGHT_BODY" />
        </g>
      </mask>
      <filter :id="id('soft')" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="1.4" />
      </filter>
    </defs>

    <!-- Left person: the candidate -->
    <g class="brand-mark__left">
      <circle cx="33.74" cy="24.31" r="16.91" :fill="`url(#${id('left')})`" />
      <path :fill="`url(#${id('left')})`" :d="LEFT_BODY" />
    </g>

    <!-- Soft fold shadow where the two inner legs overlap: only meaningful once merged -->
    <g class="brand-mark__fold" :clip-path="`url(#${id('clip-left')})`">
      <path :filter="`url(#${id('soft')})`" fill="#1E3A8A" opacity=".2" transform="translate(-1.2 1)" :d="RIGHT_BODY" />
    </g>

    <!-- Right person: the client -->
    <g class="brand-mark__right">
      <circle cx="94.26" cy="24.31" r="16.91" :fill="`url(#${id('right-head')})`" />
      <path :fill="`url(#${id('right')})`" :d="RIGHT_BODY" />
    </g>

    <!-- One-off highlight sweep, masked to the mark -->
    <g v-if="props.animated" :mask="`url(#${id('mask')})`" aria-hidden="true">
      <g transform="rotate(18 64 64)">
        <rect class="brand-mark__sheen" x="40" y="-24" width="48" height="176" :fill="`url(#${id('sheen')})`" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.brand-mark { overflow: visible; display: block; }
.brand-mark__left, .brand-mark__right, .brand-mark__fold { transform-box: fill-box; transform-origin: 50% 60%; }
.brand-mark__sheen { opacity: 0; }

/* Walk in from both sides and merge into the M: 1.2 s, ease-in-out, no bounce */
.brand-mark--animated .brand-mark__left  { animation: brand-in-left  1.2s cubic-bezier(0.4, 0, 0.2, 1) both; }
.brand-mark--animated .brand-mark__right { animation: brand-in-right 1.2s cubic-bezier(0.4, 0, 0.2, 1) both; }
.brand-mark--animated .brand-mark__fold  { animation: brand-fade 0.35s cubic-bezier(0.4, 0, 0.2, 1) 0.95s both; }
.brand-mark--animated .brand-mark__sheen { animation: brand-sheen 0.48s cubic-bezier(0.4, 0, 0.6, 1) 1.28s both; }

/* 82 user units ≈ 46px at a 72px render */
@keyframes brand-in-left {
  0%   { transform: translateX(-82px) scale(0.96); opacity: 0; }
  40%  { opacity: 1; }
  86%  { transform: translateX(1.4px) scale(1); }
  100% { transform: translateX(0) scale(1); opacity: 1; }
}
@keyframes brand-in-right {
  0%   { transform: translateX(82px) scale(0.96); opacity: 0; }
  40%  { opacity: 1; }
  86%  { transform: translateX(-1.4px) scale(1); }
  100% { transform: translateX(0) scale(1); opacity: 1; }
}
@keyframes brand-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes brand-sheen {
  0%   { transform: translateX(-120px); opacity: 0; }
  20%  { opacity: 1; }
  80%  { opacity: 1; }
  100% { transform: translateX(120px); opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .brand-mark--animated .brand-mark__left,
  .brand-mark--animated .brand-mark__right,
  .brand-mark--animated .brand-mark__fold,
  .brand-mark--animated .brand-mark__sheen { animation: none; }
}
</style>
