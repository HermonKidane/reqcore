<script setup lang="ts">
import { Moon, Sun } from 'lucide-vue-next'

/**
 * Auth shell ("Aurora"): a frosted glass card floating over a slowly moving aurora
 * gradient. Light by default; the sun/moon switch uses the app-wide colour mode
 * (same `.dark` class + localStorage key as the dashboard), so the choice carries over.
 */
const { isDark, toggle } = useColorMode()
</script>

<template>
  <div class="auth-shell">
    <div class="auth-scene" aria-hidden="true">
      <div class="auth-blob auth-blob-1" />
      <div class="auth-blob auth-blob-2" />
      <div class="auth-blob auth-blob-3" />
      <div class="auth-blob auth-blob-4" />
      <div class="auth-vignette" />
      <div class="auth-grain" />
    </div>

    <div class="absolute right-4 top-4 z-10 flex items-center gap-2">
      <button
        type="button"
        class="auth-theme-toggle"
        :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
        :title="isDark ? 'Light mode' : 'Dark mode'"
        @click="toggle"
      >
        <Sun v-if="isDark" class="size-4" />
        <Moon v-else class="size-4" />
      </button>
      <LanguageSwitcher />
    </div>

    <div class="auth-page">
      <main class="auth-stage">
        <section class="auth-card">
          <header class="auth-brand">
            <BrandMark :size="72" animated class="auth-mark" />
            <h1 class="auth-wordmark"><span class="auth-wordmark-my">My</span>Recruiter</h1>
            <p class="auth-tagline">From first call to <em>fee collected.</em></p>
          </header>
          <slot />
        </section>
      </main>
      <footer class="auth-legal">
        © {{ new Date().getFullYear() }} MyRecruiter<span class="auth-dot" aria-hidden="true">·</span><NuxtLink :to="$localePath('/')">ats.myrecruiter.uk</NuxtLink>
      </footer>
    </div>
  </div>
</template>

<style>
/* ---------------------------------------------------------------------------
   Auth shell tokens. Light = Aurora; `.dark` = Aurora at night (smoked glass).
   Not scoped: the pages rendered in <slot /> use the .auth-* form classes too.
   --------------------------------------------------------------------------- */
.auth-shell {
  --auth-ease: cubic-bezier(0.4, 0, 0.2, 1);
  --auth-primary: oklch(54% 0.2 264);
  --auth-primary-hover: oklch(47% 0.2 264);
  --auth-primary-glow: rgba(47, 99, 225, 0.45);

  --auth-scene: linear-gradient(135deg, #dce3ff 0%, #ece4ff 50%, #ffe9df 100%);
  --auth-blob-1: #3a63ff; --auth-blob-2: #a487ff; --auth-blob-3: #ffb08a; --auth-blob-4: #5aa2ff;
  --auth-blob-alpha: 1; --auth-grain: 0.04; --auth-vignette: 0;

  --auth-text: #0c1222; --auth-text-2: #303a50; --auth-label: #151c2e;
  --auth-link: #1e3fb0; --auth-wm-my: #2045c4;
  --auth-card-bg: linear-gradient(160deg, rgba(255,255,255,0.78) 0%, rgba(255,255,255,0.6) 45%, rgba(255,255,255,0.7) 100%);
  --auth-card-solid: #f7f6fd;
  --auth-card-border: rgba(255,255,255,0.6);
  --auth-card-rim: linear-gradient(150deg, rgba(255,255,255,0.95), rgba(255,255,255,0.2) 35%, rgba(255,255,255,0.1) 65%, rgba(255,255,255,0.6));
  --auth-card-shadow:
    inset 0 1px 0 rgba(255,255,255,0.9),
    0 2px 6px rgba(40,30,110,0.06),
    0 24px 48px -16px rgba(50,40,140,0.22),
    0 56px 110px -36px rgba(60,40,150,0.32);
  --auth-card-sat: 180%;
  --auth-specular: 1;

  --auth-in-bg: #ffffff; --auth-in-border: #d4d6ea; --auth-in-border-hover: #b8bcdb;
  --auth-in-text: #0c1222; --auth-in-ph: #5e6880; --auth-in-shadow: 0 1px 2px rgba(30,20,90,0.06);
  --auth-ring: rgba(47, 99, 225, 0.24); --auth-focus: #2f63e1;
  --auth-btn2-bg: #ffffff; --auth-btn2-border: #d4d6ea; --auth-btn2-hover: #f5f5fd; --auth-btn2-text: #151c2e;
  --auth-rule: rgba(30, 30, 80, 0.14); --auth-divider-text: #39425a;
  --auth-legal: #1f2740; --auth-legal-bg: rgba(255,255,255,0.62);
  --auth-alert-bg: #fff1f2; --auth-alert-border: #fecdd3; --auth-alert-text: #9f1239;
  --auth-toggle-bg: rgba(255,255,255,0.6); --auth-toggle-text: #151c2e; --auth-toggle-border: rgba(255,255,255,0.8);

  position: relative;
  min-height: 100vh; min-height: 100dvh;
  color: var(--auth-text);
  background: #e8e6fb;
  font-feature-settings: "cv11", "ss01", "ss03";
}

.dark .auth-shell {
  --auth-scene: linear-gradient(158deg, #0b1324 0%, #0b1220 38%, #0f1218 72%, #131417 100%);
  --auth-blob-alpha: 0.42; --auth-grain: 0.05; --auth-vignette: 1;

  --auth-text: #eef2f9; --auth-text-2: #a7b2c6; --auth-label: #d5dce8;
  --auth-link: #93b2ff; --auth-wm-my: #8daeff;
  --auth-card-bg: linear-gradient(180deg, rgba(22,28,42,0.66), rgba(12,16,26,0.72));
  --auth-card-solid: #121825;
  --auth-card-border: rgba(255,255,255,0.07);
  --auth-card-rim: linear-gradient(135deg, rgba(235,240,255,0.55) 0%, rgba(200,210,235,0.18) 22%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.03) 75%, rgba(170,190,240,0.16) 100%);
  --auth-card-shadow:
    inset 0 1px 0 rgba(255,255,255,0.06),
    0 0 0 1px rgba(0,0,0,0.35),
    0 2px 4px rgba(0,0,0,0.25),
    0 24px 48px -16px rgba(0,0,0,0.6),
    0 64px 120px -40px rgba(2,6,23,0.9);
  --auth-card-sat: 130%;
  --auth-specular: 0;

  --auth-in-bg: #141b29; --auth-in-border: #2a3448; --auth-in-border-hover: #3a465e;
  --auth-in-text: #eef2f9; --auth-in-ph: #8a96ab; --auth-in-shadow: inset 0 1px 2px rgba(0,0,0,0.35);
  --auth-ring: rgba(110, 150, 255, 0.28); --auth-focus: #6e96ff;
  --auth-btn2-bg: #141b29; --auth-btn2-border: #2a3448; --auth-btn2-hover: #1a2233; --auth-btn2-text: #e3e9f3;
  --auth-rule: rgba(255,255,255,0.1); --auth-divider-text: #9aa6bb;
  --auth-legal: #8e9ab0; --auth-legal-bg: transparent;
  --auth-alert-bg: #2a1218; --auth-alert-border: #5b1d2a; --auth-alert-text: #fda4af;
  --auth-toggle-bg: rgba(20,27,41,0.7); --auth-toggle-text: #e3e9f3; --auth-toggle-border: rgba(255,255,255,0.1);

  background: #0d1220;
}

/* Scene: aurora of electric blue, soft purple and warm peach, drifting slowly */
.auth-scene { position: fixed; inset: 0; overflow: hidden; z-index: 0; pointer-events: none; background: var(--auth-scene); transition: background 0.4s var(--auth-ease); }
.auth-blob { position: absolute; border-radius: 50%; filter: blur(40px); opacity: var(--auth-blob-alpha); will-change: transform; transition: opacity 0.4s var(--auth-ease); }
.auth-blob-1 { width: 80vmax; height: 46vmax; left: -18vmax; top: -12vmax; background: radial-gradient(closest-side, var(--auth-blob-1) 0%, rgba(58,99,255,0.55) 45%, rgba(58,99,255,0) 100%); animation: auth-aurora-a 34s ease-in-out infinite alternate; }
.auth-blob-2 { width: 74vmax; height: 50vmax; right: -20vmax; top: 4vh; background: radial-gradient(closest-side, var(--auth-blob-2) 0%, rgba(164,135,255,0.55) 45%, rgba(164,135,255,0) 100%); animation: auth-aurora-b 38s ease-in-out infinite alternate; }
.auth-blob-3 { width: 78vmax; height: 44vmax; left: 6vw; bottom: -16vmax; background: radial-gradient(closest-side, var(--auth-blob-3) 0%, rgba(255,176,138,0.6) 45%, rgba(255,176,138,0) 100%); animation: auth-aurora-c 30s ease-in-out infinite alternate; }
.auth-blob-4 { width: 50vmax; height: 30vmax; left: -10vmax; bottom: 2vh; background: radial-gradient(closest-side, var(--auth-blob-4) 0%, rgba(90,162,255,0) 100%); animation: auth-aurora-d 26s ease-in-out infinite alternate; }
.auth-vignette { position: absolute; inset: 0; opacity: var(--auth-vignette); background: radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,0) 55%, rgba(0,0,0,0.45) 100%); transition: opacity 0.4s var(--auth-ease); }
.auth-grain {
  position: absolute; inset: -50%; opacity: var(--auth-grain);
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
@keyframes auth-aurora-a { 0% { transform: translate3d(0,0,0) rotate(-12deg); } 100% { transform: translate3d(14vmax, 8vmax, 0) rotate(8deg) scale(1.1); } }
@keyframes auth-aurora-b { 0% { transform: translate3d(0,0,0) rotate(18deg); } 100% { transform: translate3d(-16vmax, 10vmax, 0) rotate(-6deg) scale(1.12); } }
@keyframes auth-aurora-c { 0% { transform: translate3d(0,0,0) rotate(-6deg); } 100% { transform: translate3d(10vmax, -12vmax, 0) rotate(10deg) scale(1.08); } }
@keyframes auth-aurora-d { 0% { transform: translate3d(0,0,0); } 100% { transform: translate3d(22vmax, -6vmax, 0) scale(1.2); } }

/* Layout */
.auth-page { position: relative; z-index: 1; min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column; align-items: center; padding: 48px 16px 24px; }
.auth-stage { flex: 1; width: 100%; display: flex; align-items: center; justify-content: center; }

/* Glass card */
.auth-card {
  position: relative; isolation: isolate;
  width: 100%; max-width: 420px;
  padding: 40px 40px 32px;
  border-radius: 24px;
  background: var(--auth-card-bg), rgba(255,255,255,0.05);
  border: 1px solid var(--auth-card-border);
  box-shadow: var(--auth-card-shadow);
  -webkit-backdrop-filter: blur(16px) saturate(var(--auth-card-sat));
  backdrop-filter: blur(16px) saturate(var(--auth-card-sat));
  transition: background 0.4s var(--auth-ease), box-shadow 0.4s var(--auth-ease), border-color 0.4s var(--auth-ease);
  animation: auth-card-in 0.7s var(--auth-ease) both;
}
.auth-card > * { position: relative; z-index: 1; }
.auth-card::before, .auth-card::after { content: ""; position: absolute; pointer-events: none; z-index: 0; border-radius: inherit; }
/* travelling specular streak (light only) */
.auth-card::before {
  inset: 0; opacity: var(--auth-specular); overflow: hidden;
  background: linear-gradient(115deg, rgba(255,255,255,0) 38%, rgba(255,255,255,0.42) 47%, rgba(255,255,255,0.12) 52%, rgba(255,255,255,0) 60%);
  background-size: 260% 100%;
  animation: auth-specular 14s ease-in-out infinite alternate;
}
/* 1px gradient rim */
.auth-card::after {
  inset: 0; padding: 1px;
  background: var(--auth-card-rim);
  -webkit-mask: linear-gradient(#000, #000) content-box, linear-gradient(#000, #000); -webkit-mask-composite: xor;
  mask: linear-gradient(#000, #000) content-box exclude, linear-gradient(#000, #000);
}
@keyframes auth-card-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes auth-specular { from { background-position: 100% 0; } to { background-position: 0% 0; } }
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .auth-card { background: var(--auth-card-solid); }
}

/* Brand header */
.auth-brand { display: flex; flex-direction: column; align-items: center; text-align: center; margin-bottom: 32px; }
.auth-wordmark { margin: 16px 0 0; font-size: 24px; line-height: 32px; font-weight: 650; letter-spacing: -0.028em; color: var(--auth-text); }
.auth-wordmark-my { color: var(--auth-wm-my); }
.auth-tagline { margin: 8px 0 0; font-size: 15px; line-height: 24px; font-weight: 450; letter-spacing: -0.006em; color: var(--auth-text-2); text-wrap: balance; }
.auth-tagline em { font-style: normal; color: var(--auth-text); font-weight: 550; }

/* Form pieces used by the sign-in / sign-up pages and SocialSignIn */
.auth-form { display: flex; flex-direction: column; gap: 20px; }
.auth-field { display: flex; flex-direction: column; gap: 8px; }
.auth-label { font-size: 13.5px; line-height: 20px; font-weight: 550; color: var(--auth-label); letter-spacing: -0.003em; }
.auth-input {
  display: block; width: 100%; height: 48px; padding: 0 16px; border-radius: 12px;
  font: inherit; font-size: 15px; color: var(--auth-in-text);
  background: var(--auth-in-bg); border: 1px solid var(--auth-in-border); box-shadow: var(--auth-in-shadow);
  transition: border-color 0.15s var(--auth-ease), box-shadow 0.15s var(--auth-ease), background-color 0.3s var(--auth-ease);
  -webkit-appearance: none; appearance: none;
}
.auth-input::placeholder { color: var(--auth-in-ph); opacity: 1; }
.auth-input:hover { border-color: var(--auth-in-border-hover); }
.auth-input:focus { outline: none; border-color: var(--auth-focus); box-shadow: 0 0 0 4px var(--auth-ring), var(--auth-in-shadow); }
.auth-btn {
  display: flex; align-items: center; justify-content: center; gap: 10px;
  width: 100%; height: 48px; padding: 0 16px; border-radius: 12px; cursor: pointer;
  font: inherit; font-size: 15px; font-weight: 600; letter-spacing: -0.006em;
  transition: background-color 0.15s var(--auth-ease), box-shadow 0.2s var(--auth-ease), transform 0.1s var(--auth-ease), border-color 0.15s var(--auth-ease);
}
.auth-btn:disabled { opacity: 0.6; cursor: not-allowed; }
.auth-btn-primary {
  color: #fff; border: 0;
  background: linear-gradient(180deg, rgba(255,255,255,0.14), rgba(255,255,255,0) 55%), var(--auth-primary);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.08), 0 1px 2px rgba(14,30,90,0.24), 0 8px 20px -8px var(--auth-primary-glow);
}
.auth-btn-primary:hover:not(:disabled) { background: linear-gradient(180deg, rgba(255,255,255,0.1), rgba(255,255,255,0) 55%), var(--auth-primary-hover); box-shadow: inset 0 1px 0 rgba(255,255,255,0.2), 0 1px 2px rgba(14,30,90,0.28), 0 12px 24px -10px var(--auth-primary-glow); }
.auth-btn-primary:active:not(:disabled) { transform: translateY(1px); }
.auth-btn-primary .auth-arrow { width: 16px; height: 16px; transition: transform 0.2s var(--auth-ease); }
.auth-btn-primary:hover .auth-arrow { transform: translateX(3px); }
.auth-btn-secondary { background: var(--auth-btn2-bg); color: var(--auth-btn2-text); border: 1px solid var(--auth-btn2-border); font-weight: 550; box-shadow: var(--auth-in-shadow); }
.auth-btn-secondary:hover:not(:disabled) { background: var(--auth-btn2-hover); border-color: var(--auth-in-border-hover); }
.auth-btn-secondary:active:not(:disabled) { transform: translateY(1px); }
.auth-btn-secondary svg { width: 18px; height: 18px; flex: none; }
.auth-divider { display: flex; align-items: center; gap: 16px; font-size: 13px; line-height: 20px; color: var(--auth-divider-text); font-weight: 450; text-transform: none; letter-spacing: 0; }
.auth-divider::before, .auth-divider::after { content: ""; flex: 1; height: 1px; background: var(--auth-rule); }
.auth-link { color: var(--auth-link); font-weight: 500; border-radius: 4px; }
.auth-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.auth-muted { font-size: 14px; line-height: 20px; color: var(--auth-text-2); text-align: center; }
.auth-alert { border-radius: 12px; border: 1px solid var(--auth-alert-border); background: var(--auth-alert-bg); color: var(--auth-alert-text); padding: 12px 14px; font-size: 14px; line-height: 20px; }
.auth-shell :focus-visible { outline: 2px solid var(--auth-focus); outline-offset: 2px; }
.auth-input--invalid { border-color: #e11d48; }
.auth-input--invalid:focus { border-color: #e11d48; box-shadow: 0 0 0 4px rgba(225, 29, 72, 0.18), var(--auth-in-shadow); }
.auth-field-error { margin: 0; font-size: 13px; line-height: 18px; color: var(--auth-alert-text); }
.dark .auth-shell .auth-field-error { color: #fda4af; }
.auth-field-hint { margin: 0; font-size: 13px; line-height: 18px; color: var(--auth-text-2); }
.auth-suggest { padding: 0; border: 0; background: none; font: inherit; font-weight: 600; color: var(--auth-link); cursor: pointer; text-decoration: underline; text-underline-offset: 3px; border-radius: 4px; }

/* Top-right controls */
.auth-theme-toggle {
  display: grid; place-items: center; width: 36px; height: 36px; border-radius: 10px; cursor: pointer;
  color: var(--auth-toggle-text); background: var(--auth-toggle-bg); border: 1px solid var(--auth-toggle-border);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
  transition: background-color 0.15s var(--auth-ease), color 0.15s var(--auth-ease);
}
.auth-theme-toggle:hover { color: var(--auth-link); }

/* Footer */
.auth-legal { position: relative; z-index: 1; margin-top: 32px; font-size: 12.5px; line-height: 16px; color: var(--auth-legal); padding: 6px 12px; border-radius: 999px; background: var(--auth-legal-bg); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.auth-legal a { color: inherit; font-weight: 450; }
.auth-legal a:hover { text-decoration: underline; }
.auth-dot { margin: 0 6px; opacity: 0.8; }

/* Responsive */
@media (max-height: 860px) and (min-width: 561px) {
  .auth-page { padding-top: 24px; padding-bottom: 16px; }
  .auth-card { padding-top: 32px; padding-bottom: 24px; }
  .auth-brand { margin-bottom: 24px; }
  .auth-form { gap: 16px; }
  .auth-legal { margin-top: 16px; }
}
@media (max-height: 780px) and (min-width: 561px) {
  .auth-input, .auth-btn { height: 44px; }
}
@media (max-width: 560px) {
  .auth-page { padding: 64px 16px 24px; }
  .auth-card { padding: 32px 24px 28px; border-radius: 20px; }
  .auth-wordmark { font-size: 22px; line-height: 28px; }
}
@media (prefers-reduced-motion: reduce) {
  .auth-blob, .auth-card, .auth-card::before { animation: none !important; }
}
</style>
