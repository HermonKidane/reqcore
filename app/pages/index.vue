<script setup lang="ts">
import {
  ArrowRight,
  Briefcase,
  ScanEye,
  UsersRound,
  ShieldCheck,
  Github,
  Settings,
  Droplets,
  KeyRound,
  HardDrive,
  Container,
  ChevronRight,
  Star,
  Map,
  Check,
  Hammer,
  Telescope,
  Quote,
  Play,
  Phone,
  LayoutDashboard,
  Users,
  Inbox,
  Bell,
  FileText,
  Eye,
  Search,
  MoreHorizontal,
} from 'lucide-vue-next'

const { t } = useI18n()

useSeoMeta({
  title: 'MyRecruiter — Applicant Tracking System',
  description:
    'MyRecruiter is the desk platform for agency recruiters — jobs, candidates, clients and a proven perm process in one place. From first call to fee collected.',
  ogTitle: 'MyRecruiter — Applicant Tracking System',
  ogDescription:
    'The desk platform for perm recruiters — jobs, candidates, clients and a proven process. From first call to fee collected.',
  ogType: 'website',
  ogImage: 'https://ats.myrecruiter.uk/og-image.png',
  twitterCard: 'summary_large_image',
  twitterTitle: 'MyRecruiter — Applicant Tracking System',
  twitterDescription:
    'The desk platform for perm recruiters. Jobs, candidates, clients and process in one place.',
})

// ─── Schema.org: Organization + WebSite ──────────────
useSchemaOrg([
  defineOrganization({
    name: 'MyRecruiter',
    url: 'https://ats.myrecruiter.uk',
    logo: 'https://ats.myrecruiter.uk/myrecruiter-icon.png',
    sameAs: ['https://github.com/reqcore-inc/reqcore'],
    description: 'The desk platform for agency recruiters — jobs, candidates, clients and a proven perm process in one place.',
  }),
  defineWebSite({
    name: 'MyRecruiter',
    description: 'The desk platform for perm recruiters. From first call to fee collected.',
  }),
  defineWebPage({
    name: 'MyRecruiter — Applicant Tracking System',
    description: 'The desk platform for agency recruiters. From first call to fee collected.',
  }),
])

const { data: session } = await authClient.useSession(useFetch)

/** Override the light body background for the dark landing page */
useHead({
  bodyAttrs: {
    style: 'background-color: #09090b;',
  },
  link: [
    {
      rel: 'preload',
      as: 'image',
      href: '/myrecruiter-icon-128.png',
      fetchpriority: 'high',
    },
  ],
})

// ─── Scroll-triggered fade-in refs ───────────────────
const valuePropsRef = useScrollFade()
const manifestoRef = useScrollFade()
const howItWorksRef = useScrollFade()
const techStackRef = useScrollFade()
const roadmapRef = useScrollFade()
const ctaRef = useScrollFade()
</script>

<template>
  <div class="min-h-screen overflow-x-hidden bg-[#09090b] text-white antialiased">

    <!-- ─── Navbar ─────────────────────────────────────── -->
    <nav class="fixed inset-x-0 top-0 z-50 border-b border-white/[0.06] bg-[#09090b]/80 backdrop-blur-xl">
      <div class="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <NuxtLink :to="$localePath('/')" class="flex items-center gap-2.5 text-[15px] font-semibold tracking-tight text-white">
          <img
            src="/myrecruiter-icon-128.png"
            alt="MyRecruiter logo"
            width="28"
            height="28"
            loading="eager"
            decoding="sync"
            fetchpriority="high"
            class="h-7 w-7 object-contain"
          />
          MyRecruiter
        </NuxtLink>

        <!-- Center nav links -->
        <div class="hidden items-center gap-1 md:flex">
          <NuxtLink
            :to="$localePath('/catalog')"
            class="rounded-md px-3 py-1.5 text-[13px] font-medium text-surface-400 transition hover:text-white"
          >
            {{ t('home.nav.features') }}
          </NuxtLink>
          <NuxtLink
            :to="$localePath('/jobs')"
            class="rounded-md px-3 py-1.5 text-[13px] font-medium text-surface-400 transition hover:text-white"
          >
            {{ t('home.nav.openPositions') }}
          </NuxtLink>
          <a
            href="#coming-soon"
            class="rounded-md px-3 py-1.5 text-[13px] font-medium text-surface-400 transition hover:text-white"
          >
            The 30 Steps
          </a>
        </div>

        <div class="flex items-center gap-2">
          <template v-if="session">
            <NuxtLink
              :to="$localePath('/dashboard')"
              class="rounded-md bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[#09090b] transition hover:bg-white/90"
            >
              {{ t('home.nav.dashboard') }}
            </NuxtLink>
          </template>
          <template v-else>
            <NuxtLink
              :to="$localePath('/auth/sign-in')"
              class="hidden rounded-md px-3 py-1.5 text-[13px] font-medium text-surface-400 transition hover:text-white sm:inline-flex"
            >
              {{ t('home.nav.logIn') }}
            </NuxtLink>
            <NuxtLink
              :to="$localePath('/auth/sign-up')"
              class="rounded-md bg-white px-3.5 py-1.5 text-[13px] font-semibold text-[#09090b] transition hover:bg-white/90"
            >
              {{ t('home.nav.signUp') }}
            </NuxtLink>
          </template>
        </div>
      </div>
    </nav>

    <!-- ─── Hero ───────────────────────────────────────── -->
    <section class="relative overflow-hidden pt-32 pb-0 sm:pt-44">
      <!-- Ambient glow — subtle, Linear-style -->
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div class="absolute top-0 left-1/2 h-[800px] w-[1200px] -translate-x-1/2 -translate-y-1/3 rounded-full bg-brand-500/[0.06] blur-[160px]" />
      </div>

      <div class="relative mx-auto max-w-5xl px-6 text-center">
        <!-- Announcement badge -->
        <div class="hero-animate hero-delay-1 mb-10 flex items-center justify-center gap-4">
          <a
            href="#coming-soon"
            class="group inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-1.5 text-[13px] font-medium text-surface-300 transition hover:border-white/[0.15] hover:bg-white/[0.06]"
          >
            <Star class="h-3.5 w-3.5 text-brand-400" :stroke-width="2" />
            {{ t('home.badge') }}
            <ChevronRight class="h-3 w-3 text-surface-500 transition group-hover:translate-x-0.5" />
          </a>
        </div>

        <!-- Hero heading — large & bold, Linear-inspired -->
        <h1 class="hero-animate hero-delay-2 text-[clamp(2.5rem,6.5vw,5.5rem)] leading-[1.05] font-extrabold tracking-[-0.03em]">
          {{ t('home.hero.titleLine1') }}<br />
          <span class="bg-gradient-to-r from-brand-400 via-brand-300 to-accent-400 bg-clip-text text-transparent">{{ t('home.hero.titleHighlight') }}</span>
        </h1>

        <!-- Subtitle -->
        <p class="hero-animate hero-delay-3 mx-auto mt-7 max-w-2xl text-lg leading-relaxed text-surface-400 sm:text-xl sm:leading-relaxed">
          {{ t('home.hero.subtitleLine1') }}
          {{ t('home.hero.subtitleLine2') }}
        </p>

        <!-- CTA buttons -->
        <div class="hero-animate hero-delay-4 mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <NuxtLink
            :to="$localePath('/auth/sign-in?live=1')"
            class="inline-flex items-center gap-2 rounded-lg bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white shadow-[0_0_20px_rgba(99,102,241,0.25)] transition hover:bg-brand-400 hover:shadow-[0_0_30px_rgba(99,102,241,0.35)]"
          >
            <Play class="h-3.5 w-3.5" />
            {{ t('home.hero.ctaDemo') }}
          </NuxtLink>
          <NuxtLink
            :to="$localePath('/auth/sign-up')"
            class="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-[#09090b] shadow-[0_0_20px_rgba(255,255,255,0.08)] transition hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.12)]"
          >
            {{ t('home.hero.ctaStart') }}
            <ArrowRight class="h-3.5 w-3.5" />
          </NuxtLink>
        </div>
        <p class="hero-animate hero-delay-4 mt-3 text-xs text-surface-500">{{ t('home.hero.hint') }}</p>
      </div>

      <!-- ─── Product Preview (Linear-style embedded UI) ── -->
      <div class="hero-animate-scale hero-delay-5 relative mx-auto mt-16 max-w-6xl px-6 sm:mt-20">
        <!-- Glow behind the window -->
        <div class="pointer-events-none absolute inset-0" aria-hidden="true">
          <div class="absolute top-1/2 left-1/2 h-[500px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/[0.08] blur-[120px]" />
        </div>

        <!-- App window frame -->
        <div class="relative overflow-hidden rounded-xl border border-white/[0.1] bg-[#0f0f12] shadow-[0_20px_70px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/[0.05]">
          <!-- Window chrome -->
          <div class="flex items-center gap-2 border-b border-white/[0.06] bg-[#0c0c0f] px-4 py-2.5">
            <span class="h-2.5 w-2.5 rounded-full bg-[#ff5f57]/80" />
            <span class="h-2.5 w-2.5 rounded-full bg-[#febc2e]/80" />
            <span class="h-2.5 w-2.5 rounded-full bg-[#28c840]/80" />
            <span class="ml-3 text-[11px] text-surface-500">MyRecruiter — Dashboard</span>
          </div>

          <!-- App layout mockup -->
          <div class="flex min-h-[420px] sm:min-h-[480px]">
            <!-- Sidebar -->
            <div class="hidden w-52 shrink-0 border-r border-white/[0.06] bg-[#0c0c0f] p-4 sm:block">
              <!-- Org -->
              <div class="mb-6 flex items-center gap-2">
                <div class="flex h-6 w-6 items-center justify-center rounded bg-brand-500 text-[9px] font-bold text-white">A</div>
                <span class="text-[13px] font-semibold text-white">Acme Corp</span>
              </div>
              <!-- Nav items -->
              <nav class="space-y-0.5">
                <div class="flex items-center gap-2.5 rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[13px] font-medium text-white">
                  <LayoutDashboard class="h-3.5 w-3.5 text-brand-400" :stroke-width="1.75" />
                  Dashboard
                </div>
                <div class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-surface-400">
                  <Briefcase class="h-3.5 w-3.5" :stroke-width="1.75" />
                  Jobs
                </div>
                <div class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-surface-400">
                  <Users class="h-3.5 w-3.5" :stroke-width="1.75" />
                  Candidates
                </div>
                <div class="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-surface-400">
                  <Inbox class="h-3.5 w-3.5" :stroke-width="1.75" />
                  Applications
                </div>
              </nav>
              <!-- Sidebar jobs list -->
              <div class="mt-6 border-t border-white/[0.06] pt-4">
                <div class="mb-2 text-[10px] font-semibold tracking-widest text-surface-500 uppercase">Open Jobs</div>
                <div class="space-y-1 text-[12px] text-surface-400">
                  <div class="truncate rounded px-2 py-1 hover:bg-white/[0.04]">Senior Frontend Engineer</div>
                  <div class="truncate rounded px-2 py-1 hover:bg-white/[0.04]">Product Designer</div>
                  <div class="truncate rounded px-2 py-1 hover:bg-white/[0.04]">DevOps Engineer</div>
                </div>
              </div>
            </div>

            <!-- Main content -->
            <div class="flex-1 p-5 sm:p-6">
              <!-- Header -->
              <div class="mb-6 flex items-center justify-between">
                <div>
                  <h3 class="text-[15px] font-semibold text-white">Recruitment Overview</h3>
                  <p class="mt-0.5 text-[12px] text-surface-500">Last 30 days</p>
                </div>
                <div class="flex items-center gap-2">
                  <div class="flex h-7 items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2.5 text-[12px] text-surface-400">
                    <Search class="h-3 w-3" :stroke-width="1.75" />
                    Search...
                  </div>
                </div>
              </div>

              <!-- Stat cards row -->
              <div class="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <div class="text-[11px] font-medium text-surface-500">Open Jobs</div>
                  <div class="mt-1 text-xl font-bold text-white">12</div>
                  <div class="mt-0.5 text-[10px] text-success-400">+3 this week</div>
                </div>
                <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <div class="text-[11px] font-medium text-surface-500">Candidates</div>
                  <div class="mt-1 text-xl font-bold text-white">248</div>
                  <div class="mt-0.5 text-[10px] text-success-400">+18 new</div>
                </div>
                <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <div class="text-[11px] font-medium text-surface-500">In Pipeline</div>
                  <div class="mt-1 text-xl font-bold text-white">67</div>
                  <div class="mt-0.5 text-[10px] text-brand-400">Active</div>
                </div>
                <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                  <div class="text-[11px] font-medium text-surface-500">Hired</div>
                  <div class="mt-1 text-xl font-bold text-white">8</div>
                  <div class="mt-0.5 text-[10px] text-accent-400">This month</div>
                </div>
              </div>

              <!-- Pipeline bar -->
              <div class="mb-6">
                <div class="mb-2 text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Pipeline</div>
                <div class="flex h-2.5 overflow-hidden rounded-full bg-white/[0.04]">
                  <div class="h-full bg-warning-500" style="width: 30%"></div>
                  <div class="h-full bg-info-500" style="width: 22%"></div>
                  <div class="h-full bg-brand-500" style="width: 25%"></div>
                  <div class="h-full bg-accent-500" style="width: 10%"></div>
                  <div class="h-full bg-success-500" style="width: 13%"></div>
                </div>
                <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px]">
                  <span class="flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-warning-500" />New 20</span>
                  <span class="flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-info-500" />Screening 15</span>
                  <span class="flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-brand-500" />Interview 17</span>
                  <span class="flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-accent-500" />Offer 7</span>
                  <span class="flex items-center gap-1"><span class="h-1.5 w-1.5 rounded-full bg-success-500" />Hired 8</span>
                </div>
              </div>

              <!-- Recent candidates table -->
              <div>
                <div class="mb-2 text-[11px] font-semibold text-surface-500 uppercase tracking-wider">Recent Applications</div>
                <div class="overflow-hidden rounded-lg border border-white/[0.06]">
                  <div class="divide-y divide-white/[0.04]">
                    <div class="flex items-center justify-between bg-white/[0.02] px-3 py-2">
                      <div class="flex items-center gap-3">
                        <div class="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500/20 text-[10px] font-bold text-brand-300">JD</div>
                        <div>
                          <div class="text-[12px] font-medium text-white">Jane Doe</div>
                          <div class="text-[10px] text-surface-500">Senior Frontend Engineer</div>
                        </div>
                      </div>
                      <span class="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-medium text-brand-400">Interview</span>
                    </div>
                    <div class="flex items-center justify-between px-3 py-2">
                      <div class="flex items-center gap-3">
                        <div class="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500/20 text-[10px] font-bold text-accent-300">AK</div>
                        <div>
                          <div class="text-[12px] font-medium text-white">Alex Kim</div>
                          <div class="text-[10px] text-surface-500">Product Designer</div>
                        </div>
                      </div>
                      <span class="rounded-full bg-warning-500/10 px-2 py-0.5 text-[10px] font-medium text-warning-400">New</span>
                    </div>
                    <div class="flex items-center justify-between bg-white/[0.02] px-3 py-2">
                      <div class="flex items-center gap-3">
                        <div class="flex h-7 w-7 items-center justify-center rounded-full bg-success-500/20 text-[10px] font-bold text-success-300">MS</div>
                        <div>
                          <div class="text-[12px] font-medium text-white">Maria Silva</div>
                          <div class="text-[10px] text-surface-500">DevOps Engineer</div>
                        </div>
                      </div>
                      <span class="rounded-full bg-accent-500/10 px-2 py-0.5 text-[10px] font-medium text-accent-400">Offer</span>
                    </div>
                    <div class="flex items-center justify-between px-3 py-2">
                      <div class="flex items-center gap-3">
                        <div class="flex h-7 w-7 items-center justify-center rounded-full bg-info-500/20 text-[10px] font-bold text-info-300">TC</div>
                        <div>
                          <div class="text-[12px] font-medium text-white">Tom Chen</div>
                          <div class="text-[10px] text-surface-500">Senior Frontend Engineer</div>
                        </div>
                      </div>
                      <span class="rounded-full bg-info-500/10 px-2 py-0.5 text-[10px] font-medium text-info-400">Screening</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Fade-out overlay at bottom -->
          <div class="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#09090b] to-transparent" />
        </div>
      </div>
    </section>

    <!-- ─── Value Props — Bento Grid ──────────────────── -->
    <section ref="valuePropsRef" class="scroll-fade relative py-28 sm:py-36">
      <!-- Ambient glow -->
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div class="absolute top-1/4 left-1/2 h-[600px] w-[900px] -translate-x-1/2 -translate-y-1/4 rounded-full bg-brand-500/[0.04] blur-[160px]" />
        <div class="absolute right-0 bottom-0 h-[400px] w-[500px] translate-x-1/4 rounded-full bg-accent-500/[0.03] blur-[140px]" />
      </div>

      <div class="relative mx-auto max-w-6xl px-6">
        <div class="mx-auto max-w-2xl text-center">
          <p class="text-sm font-semibold tracking-[0.2em] text-brand-400 uppercase">Why MyRecruiter</p>
          <h2 class="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
            Everything your desk needs. Nothing it doesn't.
          </h2>
          <p class="mt-5 text-base leading-relaxed text-surface-400 sm:text-lg">
            Run the full perm cycle from first call to fee collected — without
            spreadsheets, scattered inboxes, or forgotten follow-ups.
          </p>
        </div>

        <!-- Bento grid — Supabase-style 2×2 balanced layout -->
        <div class="mt-16 grid gap-4 sm:grid-cols-2">

          <!-- ── Card 1: Ownership over Access ─────────────── -->
          <div class="stagger-child bento-card group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0f] transition-all duration-300 hover:border-white/[0.12]">
            <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true">
              <div class="absolute -top-20 -left-20 h-52 w-52 rounded-full bg-brand-500/[0.08] blur-[80px]" />
            </div>

            <div class="relative p-7 pb-4">
              <div class="mb-1 flex items-center gap-2.5">
                <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500/10 text-brand-400 ring-1 ring-inset ring-brand-500/20">
                  <img src="/database-icon.png" alt="Database" class="h-4 w-4 object-contain" />
                </div>
                <h3 class="text-[15px] font-semibold text-white">Everything in one place</h3>
              </div>
              <p class="mt-3 text-sm leading-relaxed text-surface-400">
                Jobs, candidates, clients and pipeline share a single record.
                Walk into every call with the <span class="font-medium text-white">full picture</span>.
              </p>
              <!-- Badges -->
              <div class="mt-4 flex flex-wrap gap-1.5">
                <span class="inline-flex items-center gap-1 rounded-full border border-brand-500/20 bg-brand-500/[0.06] px-2.5 py-0.5 text-[10px] font-medium text-brand-300">
                  <Check class="h-2.5 w-2.5" :stroke-width="2.5" /> Jobs + candidates
                </span>
                <span class="inline-flex items-center gap-1 rounded-full border border-brand-500/20 bg-brand-500/[0.06] px-2.5 py-0.5 text-[10px] font-medium text-brand-300">
                  <Check class="h-2.5 w-2.5" :stroke-width="2.5" /> Clients + contacts
                </span>
                <span class="inline-flex items-center gap-1 rounded-full border border-brand-500/20 bg-brand-500/[0.06] px-2.5 py-0.5 text-[10px] font-medium text-brand-300">
                  <Check class="h-2.5 w-2.5" :stroke-width="2.5" /> Documents &amp; CVs
                </span>
              </div>
            </div>

            <!-- Visual area — database tables, bottom-aligned with fade -->
            <div class="relative mt-auto px-7 pt-2 pb-0">
              <div class="grid grid-cols-2 gap-2.5">
                <div class="overflow-hidden rounded-t-lg border border-b-0 border-white/[0.06] bg-white/[0.02]">
                  <div class="border-b border-white/[0.06] bg-white/[0.03] px-3 py-1.5">
                    <div class="flex items-center gap-1.5">
                      <img src="/database-icon.png" alt="Database" class="h-2.5 w-2.5 object-contain" />
                      <span class="text-[10px] font-semibold text-surface-300">candidates</span>
                    </div>
                  </div>
                  <div class="space-y-0.5 px-3 py-2 text-[10px] font-mono text-surface-500">
                    <div class="flex items-center gap-1.5"><KeyRound class="h-2 w-2 text-brand-400" :stroke-width="2" /><span class="text-surface-300">id</span> <span class="ml-auto text-brand-400/60">uuid</span></div>
                    <div class="flex items-center gap-1.5"><span class="w-2" /><span class="text-surface-300">name</span> <span class="ml-auto text-surface-600">text</span></div>
                    <div class="flex items-center gap-1.5"><span class="w-2" /><span class="text-surface-300">email</span> <span class="ml-auto text-surface-600">text</span></div>
                    <div class="flex items-center gap-1.5"><span class="w-2" /><span class="text-surface-300">skills</span> <span class="ml-auto text-surface-600">jsonb</span></div>
                    <div class="flex items-center gap-1.5"><span class="w-2" /><span class="text-surface-300">status</span> <span class="ml-auto text-surface-600">enum</span></div>
                  </div>
                </div>
                <div class="overflow-hidden rounded-t-lg border border-b-0 border-white/[0.06] bg-white/[0.02]">
                  <div class="border-b border-white/[0.06] bg-white/[0.03] px-3 py-1.5">
                    <div class="flex items-center gap-1.5">
                      <HardDrive class="h-2.5 w-2.5 text-accent-400" :stroke-width="2" />
                      <span class="text-[10px] font-semibold text-surface-300">documents</span>
                    </div>
                  </div>
                  <div class="space-y-0.5 px-3 py-2 text-[10px] font-mono text-surface-500">
                    <div class="flex items-center gap-1.5"><KeyRound class="h-2 w-2 text-brand-400" :stroke-width="2" /><span class="text-surface-300">id</span> <span class="ml-auto text-brand-400/60">uuid</span></div>
                    <div class="flex items-center gap-1.5"><span class="w-2" /><span class="text-surface-300">file_key</span> <span class="ml-auto text-surface-600">text</span></div>
                    <div class="flex items-center gap-1.5"><span class="w-2" /><span class="text-surface-300">mime</span> <span class="ml-auto text-surface-600">text</span></div>
                    <div class="flex items-center gap-1.5"><span class="w-2" /><span class="text-surface-300">size_kb</span> <span class="ml-auto text-surface-600">int</span></div>
                    <div class="flex items-center gap-1.5"><span class="w-2" /><span class="text-surface-300">org_id</span> <span class="ml-auto text-surface-600">uuid</span></div>
                  </div>
                </div>
              </div>
              <!-- Bottom fade -->
              <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0c0c0f] to-transparent" />
            </div>
          </div>

          <!-- ── Card 2: Full Visibility ────────────── -->
          <div class="stagger-child bento-card group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0f] transition-all duration-300 hover:border-white/[0.12]">
            <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true">
              <div class="absolute -top-16 -right-16 h-48 w-48 rounded-full bg-accent-500/[0.1] blur-[60px]" />
            </div>

            <div class="relative p-7 pb-4">
              <div class="mb-1 flex items-center gap-2.5">
                <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400 ring-1 ring-inset ring-accent-500/20">
                  <ScanEye class="h-4 w-4" :stroke-width="1.75" />
                </div>
                <h3 class="text-[15px] font-semibold text-white">Know your next action</h3>
              </div>
              <p class="mt-3 text-sm leading-relaxed text-surface-400">
                Every live job shows its pipeline at a glance — who's where, what's next, and what's stuck.
                A <span class="font-medium text-white">visual Kanban board</span> keeps your desk honest.
              </p>
            </div>

            <!-- Visual area — pipeline stages, bottom-aligned with fade -->
            <div class="relative mt-auto px-7 pt-2 pb-0">
              <div class="overflow-hidden rounded-t-lg border border-b-0 border-white/[0.06] bg-white/[0.02]">
                <div class="border-b border-white/[0.06] bg-white/[0.03] px-3 py-1.5">
                  <span class="text-[10px] font-semibold text-surface-300">Pipeline — Senior Frontend Engineer</span>
                </div>
                <div class="space-y-2 px-3 py-2.5">
                  <div>
                    <div class="flex items-center justify-between text-[10px]">
                      <span class="text-surface-400">New</span>
                      <span class="font-medium text-warning-400">12</span>
                    </div>
                    <div class="mt-0.5 h-1 overflow-hidden rounded-full bg-white/[0.04]">
                      <div class="h-full rounded-full bg-gradient-to-r from-warning-500 to-warning-400" style="width: 40%" />
                    </div>
                  </div>
                  <div>
                    <div class="flex items-center justify-between text-[10px]">
                      <span class="text-surface-400">Screening</span>
                      <span class="font-medium text-info-400">8</span>
                    </div>
                    <div class="mt-0.5 h-1 overflow-hidden rounded-full bg-white/[0.04]">
                      <div class="h-full rounded-full bg-gradient-to-r from-info-500 to-info-400" style="width: 27%" />
                    </div>
                  </div>
                  <div>
                    <div class="flex items-center justify-between text-[10px]">
                      <span class="text-surface-400">Interview</span>
                      <span class="font-medium text-brand-400">6</span>
                    </div>
                    <div class="mt-0.5 h-1 overflow-hidden rounded-full bg-white/[0.04]">
                      <div class="h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400" style="width: 20%" />
                    </div>
                  </div>
                  <div>
                    <div class="flex items-center justify-between text-[10px]">
                      <span class="text-surface-400">Hired</span>
                      <span class="font-medium text-success-400">4</span>
                    </div>
                    <div class="mt-0.5 h-1 overflow-hidden rounded-full bg-white/[0.04]">
                      <div class="h-full rounded-full bg-gradient-to-r from-success-500 to-success-400" style="width: 13%" />
                    </div>
                  </div>
                </div>
              </div>
              <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0c0c0f] to-transparent" />
            </div>
          </div>

          <!-- ── Card 3: Anti-Growth Tax ───────────────────── -->
          <div class="stagger-child bento-card group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0f] transition-all duration-300 hover:border-white/[0.12]">
            <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true">
              <div class="absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-success-500/[0.08] blur-[60px]" />
            </div>

            <div class="relative p-7 pb-4">
              <div class="mb-1 flex items-center gap-2.5">
                <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-success-500/10 text-success-400 ring-1 ring-inset ring-success-500/20">
                  <UsersRound class="h-4 w-4" :stroke-width="1.75" />
                </div>
                <h3 class="text-[15px] font-semibold text-white">Prepped for every conversation</h3>
              </div>
              <p class="mt-3 text-sm leading-relaxed text-surface-400">
                AI-assisted call scripts and structured post-call notes turn every conversation into
                <span class="font-medium text-white">clear next steps</span>. You focus on the relationship — the platform keeps the record.
              </p>
            </div>

            <!-- Visual area — call prep, bottom-aligned with fade -->
            <div class="relative mt-auto px-7 pt-2 pb-0">
              <div class="space-y-2">
                <div class="flex items-center gap-3 rounded-t-lg border border-b-0 border-brand-500/10 bg-brand-500/[0.04] px-3.5 py-2">
                  <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-brand-500/10 text-[9px] font-bold text-brand-400">1</div>
                  <div class="min-w-0 flex-1">
                    <div class="text-[10px] font-medium text-surface-300">Pre-call script — trial close</div>
                    <div class="text-[9px] text-surface-500">Generated from the job order + candidate history</div>
                  </div>
                  <span class="text-[12px] font-semibold text-brand-400">Ready</span>
                </div>
                <div class="flex items-center gap-3 rounded-lg border border-success-500/15 bg-success-500/[0.04] px-3.5 py-2">
                  <div class="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-success-500/10 text-[9px] font-bold text-success-400">&#10003;</div>
                  <div class="min-w-0 flex-1">
                    <div class="text-[10px] font-medium text-surface-300">Post-call notes</div>
                    <div class="text-[9px] text-surface-500">Structured, saved to the candidate record</div>
                  </div>
                  <span class="text-[12px] font-semibold text-success-400">Saved</span>
                </div>
              </div>

              <!-- Team avatars row -->
              <div class="mt-3 flex items-center gap-1">
                <div class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/20 text-[8px] font-bold text-brand-300 ring-1 ring-inset ring-brand-500/20">HK</div>
                <div class="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-accent-500/20 text-[8px] font-bold text-accent-300 ring-1 ring-inset ring-accent-500/20">JD</div>
                <div class="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-success-500/20 text-[8px] font-bold text-success-300 ring-1 ring-inset ring-success-500/20">MS</div>
                <div class="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-warning-500/20 text-[8px] font-bold text-warning-300 ring-1 ring-inset ring-warning-500/20">TC</div>
                <div class="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-info-500/20 text-[8px] font-bold text-info-300 ring-1 ring-inset ring-info-500/20">LW</div>
                <div class="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.06] text-[8px] font-bold text-surface-400 ring-1 ring-inset ring-white/[0.08]">+</div>
                <span class="ml-2 text-[10px] text-surface-500">Your whole desk, one system</span>
              </div>
              <div class="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-[#0c0c0f] to-transparent" />
            </div>
          </div>

          <!-- ── Card 4: Privacy Sovereignty ───────────────── -->
          <div class="stagger-child bento-card group relative flex flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0f] transition-all duration-300 hover:border-white/[0.12]">
            <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true">
              <div class="absolute -bottom-20 -right-16 h-48 w-48 rounded-full bg-warning-500/[0.06] blur-[70px]" />
            </div>

            <div class="relative p-7 pb-4">
              <div class="mb-1 flex items-center gap-2.5">
                <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-warning-500/10 text-warning-400 ring-1 ring-inset ring-warning-500/20">
                  <ShieldCheck class="h-4 w-4" :stroke-width="1.75" />
                </div>
                <h3 class="text-[15px] font-semibold text-white">Your data, protected</h3>
              </div>
              <p class="mt-3 text-sm leading-relaxed text-surface-400">
                Candidate and client records live on our own secure infrastructure — access-controlled and GDPR-conscious.
                <span class="font-medium text-white">Your relationships stay the agency's asset.</span>
              </p>
            </div>

            <!-- Visual area — infra diagram, bottom-aligned with fade -->
            <div class="relative mt-auto px-7 pt-2 pb-0">
              <div class="overflow-hidden rounded-t-lg border border-b-0 border-white/[0.06] bg-white/[0.02]">
                <div class="border-b border-white/[0.06] bg-white/[0.03] px-3 py-1.5">
                  <span class="text-[10px] font-semibold text-surface-300">ats.myrecruiter.uk — private infrastructure</span>
                </div>
                <div class="space-y-1.5 px-3 py-2.5">
                  <div class="flex items-center gap-2 text-[10px]">
                    <ShieldCheck class="h-3 w-3 text-success-400" :stroke-width="2" />
                    <span class="font-mono text-surface-300">encrypted connection · role-based access</span>
                  </div>
                  <div class="ml-5 space-y-1 border-l border-white/[0.06] pl-3">
                    <div class="flex items-center gap-1.5 text-[9px] text-surface-500">
                      <span class="h-1.5 w-1.5 rounded-full bg-success-400" /> candidate records
                    </div>
                    <div class="flex items-center gap-1.5 text-[9px] text-surface-500">
                      <span class="h-1.5 w-1.5 rounded-full bg-success-400" /> client records
                    </div>
                    <div class="flex items-center gap-1.5 text-[9px] text-surface-500">
                      <span class="h-1.5 w-1.5 rounded-full bg-success-400" /> documents &amp; CVs
                    </div>
                  </div>
                </div>
              </div>
              <div class="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#0c0c0f] to-transparent" />
            </div>
          </div>

        </div>

        <!-- Tagline -->
        <p class="mt-10 text-center text-[15px] text-surface-500">
          <span class="font-semibold text-surface-300">From first call to fee collected.</span> One workflow, zero gaps.
        </p>
      </div>
    </section>

    <!-- ─── Manifesto ──────────────────────────────────── -->
    <section ref="manifestoRef" class="scroll-fade relative overflow-hidden border-t border-white/[0.06] py-24 sm:py-32">
      <!-- Glow -->
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div class="absolute top-0 left-1/3 h-[500px] w-[600px] -translate-y-1/3 rounded-full bg-brand-500/[0.05] blur-[150px]" />
        <div class="absolute right-0 bottom-1/4 h-[400px] w-[500px] translate-x-1/4 rounded-full bg-accent-500/[0.04] blur-[130px]" />
      </div>

      <div class="relative mx-auto max-w-3xl px-6">
        <div class="mx-auto max-w-2xl text-center">
          <p class="text-sm font-semibold tracking-[0.2em] text-brand-400 uppercase">Why we exist</p>
          <h2 class="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Why I built this
          </h2>
        </div>

        <!-- Letter-style manifesto card -->
        <div class="relative mt-14 rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 sm:p-12">
          <!-- Decorative quote mark -->
          <Quote
            class="absolute -top-4 left-8 h-8 w-8 rotate-180 text-brand-500/30 sm:left-12"
            :stroke-width="1.5"
          />

          <div class="space-y-6 text-base leading-[1.8] text-surface-300 sm:text-lg sm:leading-[1.85]">
            <p>
              I started this agency to do contingency perm recruitment
              <span class="font-semibold text-white">properly</span> — proper qualification,
              proper prep, proper follow-through. Too much of our industry runs on
              memory, inboxes and good intentions.
            </p>

            <p>
              So I built the platform I always wanted to work from: one that tells you
              <span class="font-semibold text-white">what to do next</span>, writes the admin
              for you, and never lets a candidate or client fall through the cracks.
            </p>

            <p>
              When you join, you don't get a login and good luck. You inherit a
              <span class="font-semibold text-white">proven operating model</span> — the same
              process, the same standards, from your first job order to your first fee.
            </p>

            <p class="text-lg font-semibold text-white sm:text-xl">
              Your job is to build relationships. The platform handles everything else.
            </p>
          </div>

          <!-- Separator + attribution -->
          <div class="mt-8 flex items-center gap-4 border-t border-white/[0.06] pt-8">
            <img src="/myrecruiter-icon-128.png" alt="MyRecruiter logo" class="h-10 w-10 object-contain" />
            <div>
              <div class="text-sm font-semibold text-white">Hermon Kidane</div>
              <div class="text-[13px] text-surface-500">Founder, MyRecruiter</div>
            </div>
          </div>
        </div>

        <!-- Inline CTA -->
        <div class="mt-10 flex justify-center">
          <NuxtLink
            :to="$localePath('/auth/sign-up')"
            class="group inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.04] px-6 py-3 text-sm font-semibold text-white transition hover:border-white/[0.2] hover:bg-white/[0.08]"
          >
            Start here
            <ArrowRight class="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
          </NuxtLink>
        </div>
      </div>
    </section>

    <!-- ─── How It Works — Linear-style premium ──────── -->
    <section ref="howItWorksRef" class="scroll-fade relative border-t border-white/[0.06] py-28 sm:py-40">
      <!-- Layered ambient glows -->
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div class="absolute top-0 left-1/2 h-[700px] w-[1000px] -translate-x-1/2 -translate-y-1/4 rounded-full bg-brand-500/[0.04] blur-[180px]" />
        <div class="absolute bottom-0 right-1/4 h-[500px] w-[600px] rounded-full bg-accent-500/[0.03] blur-[160px]" />
      </div>

      <div class="relative mx-auto max-w-5xl px-6">
        <!-- Section header -->
        <div class="mx-auto max-w-2xl text-center">
          <p class="text-sm font-semibold tracking-[0.2em] text-brand-400 uppercase">How It Works</p>
          <h2 class="mt-4 text-3xl font-bold tracking-[-0.02em] text-white sm:text-4xl lg:text-[2.75rem]">
            From job order to fee collected
          </h2>
          <p class="mt-5 text-base leading-relaxed text-surface-400 sm:text-lg">
            One workflow, three movements. The platform guides you through each.
          </p>
        </div>

        <!-- Steps with vertical timeline -->
        <div class="relative mt-20 sm:mt-24">
          <!-- Vertical gradient line — visible on sm+ -->
          <div class="pointer-events-none absolute top-0 bottom-0 left-6 hidden w-px sm:block" aria-hidden="true">
            <div class="h-full w-full bg-gradient-to-b from-brand-500/40 via-brand-500/20 to-transparent" />
          </div>

          <!-- ── Step 1: Deploy ─────────────────────────── -->
          <div class="stagger-child relative sm:pl-20">
            <!-- Timeline node -->
            <div class="absolute top-0 left-0 hidden sm:block" aria-hidden="true">
              <div class="relative flex h-12 w-12 items-center justify-center">
                <div class="absolute inset-0 rounded-full bg-brand-500/10 blur-md" />
                <div class="relative flex h-12 w-12 items-center justify-center rounded-full border border-brand-500/30 bg-[#0c0c0f]">
                  <span class="how-step-number text-sm font-bold">01</span>
                </div>
              </div>
            </div>

            <!-- Content + Visual -->
            <div class="group overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0f] transition-all duration-500 hover:border-white/[0.12]">
              <!-- Hover glow -->
              <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true">
                <div class="absolute -top-24 -left-24 h-64 w-64 rounded-full bg-brand-500/[0.08] blur-[100px]" />
              </div>

              <div class="relative grid gap-0 lg:grid-cols-[1fr,1.2fr]">
                <!-- Text -->
                <div class="flex flex-col justify-center p-8 sm:p-10">
                  <div class="mb-4 sm:hidden">
                    <span class="how-step-number text-xs font-bold">STEP 01</span>
                  </div>
                  <h3 class="text-xl font-bold tracking-tight text-white sm:text-2xl">Take the order, build the search</h3>
                  <p class="mt-3 text-[15px] leading-relaxed text-surface-400">
                    Capture a complete job order, plan the sourcing approach and build your longlist.
                    The brief, the plan and every name stay in
                    <span class="font-medium text-surface-300">one place</span>.
                  </p>
                  <div class="mt-5 flex flex-wrap gap-2">
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-surface-300">
                      <Briefcase class="h-3 w-3 text-brand-400" :stroke-width="2" />
                      Full job order
                    </span>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-surface-300">
                      <Check class="h-3 w-3 text-success-400" :stroke-width="2.5" />
                      Sourcing plan
                    </span>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-surface-300">
                      <UsersRound class="h-3 w-3 text-accent-400" :stroke-width="2" />
                      Longlist builder
                    </span>
                  </div>
                </div>

                <!-- Job order mockup -->
                <div class="relative border-t border-white/[0.06] bg-[#0a0a0d] lg:border-t-0 lg:border-l">
                  <!-- Window chrome -->
                  <div class="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
                    <span class="h-2 w-2 rounded-full bg-[#ff5f57]/70" />
                    <span class="h-2 w-2 rounded-full bg-[#febc2e]/70" />
                    <span class="h-2 w-2 rounded-full bg-[#28c840]/70" />
                    <span class="ml-3 text-[11px] text-surface-600">Job Order</span>
                  </div>
                  <!-- Job order content -->
                  <div class="p-5 font-mono text-[12px] leading-[1.8] sm:p-6 sm:text-[13px]">
                    <div class="text-surface-500">$ new job-order</div>
                    <div class="mt-3 space-y-0.5 text-[11px]">
                      <div class="flex items-center gap-2">
                        <span class="text-surface-500">Role</span>
                        <span class="text-surface-300">Head of Quality — Life Sciences</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-surface-500">Client</span>
                        <span class="text-surface-300">Confidential — Series C biotech</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-surface-500">Package</span>
                        <span class="text-surface-300">£75–90k + bonus</span>
                      </div>
                      <div class="mt-2 flex items-center gap-2">
                        <span class="text-success-400">✓</span>
                        <span class="text-surface-500">Requirements captured</span>
                        <span class="ml-auto text-success-400/70">8/8</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <span class="text-success-400">✓</span>
                        <span class="text-surface-500">Sourcing plan drafted</span>
                        <span class="ml-auto text-success-400/70">Ready</span>
                      </div>
                      <div class="mt-2 text-surface-400">
                        <span class="text-brand-400">→</span> Saved to your pipeline
                      </div>
                    </div>
                  </div>
                  <!-- Bottom fade -->
                  <div class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#0a0a0d] to-transparent" />
                </div>
              </div>
            </div>
          </div>

          <!-- ── Step 2: Configure ──────────────────────── -->
          <div class="stagger-child relative mt-6 sm:mt-10 sm:pl-20">
            <!-- Timeline node -->
            <div class="absolute top-0 left-0 hidden sm:block" aria-hidden="true">
              <div class="relative flex h-12 w-12 items-center justify-center">
                <div class="absolute inset-0 rounded-full bg-accent-500/10 blur-md" />
                <div class="relative flex h-12 w-12 items-center justify-center rounded-full border border-accent-500/30 bg-[#0c0c0f]">
                  <span class="how-step-number-accent text-sm font-bold">02</span>
                </div>
              </div>
            </div>

            <!-- Content + Visual -->
            <div class="group overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0f] transition-all duration-500 hover:border-white/[0.12]">
              <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true">
                <div class="absolute -top-20 -right-20 h-56 w-56 rounded-full bg-accent-500/[0.08] blur-[80px]" />
              </div>

              <div class="relative grid gap-0 lg:grid-cols-[1.2fr,1fr]">
                <!-- Config UI mockup -->
                <div class="relative order-2 border-t border-white/[0.06] bg-[#0a0a0d] p-5 sm:p-6 lg:order-1 lg:border-t-0 lg:border-r">
                  <!-- Mini config UI -->
                  <div class="space-y-4">
                    <!-- Org header -->
                    <div class="flex items-center justify-between rounded-lg border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                      <div class="flex items-center gap-3">
                        <div class="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-[10px] font-bold text-white">M</div>
                        <div>
                          <div class="text-[13px] font-semibold text-white">MyRecruiter</div>
                          <div class="text-[10px] text-surface-500">Your desk is ready</div>
                        </div>
                      </div>
                      <Check class="h-4 w-4 text-success-400" :stroke-width="2.5" />
                    </div>

                    <!-- Pipeline config -->
                    <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                      <div class="mb-3 text-[11px] font-semibold tracking-wider text-surface-500 uppercase">Hiring Pipeline</div>
                      <div class="flex items-center gap-2">
                        <div class="flex-1 rounded-md bg-warning-500/10 px-3 py-1.5 text-center text-[10px] font-medium text-warning-400 ring-1 ring-inset ring-warning-500/20">New</div>
                        <ChevronRight class="h-3 w-3 shrink-0 text-surface-600" />
                        <div class="flex-1 rounded-md bg-info-500/10 px-3 py-1.5 text-center text-[10px] font-medium text-info-400 ring-1 ring-inset ring-info-500/20">Screen</div>
                        <ChevronRight class="h-3 w-3 shrink-0 text-surface-600" />
                        <div class="flex-1 rounded-md bg-brand-500/10 px-3 py-1.5 text-center text-[10px] font-medium text-brand-400 ring-1 ring-inset ring-brand-500/20">Interview</div>
                        <ChevronRight class="h-3 w-3 shrink-0 text-surface-600" />
                        <div class="flex-1 rounded-md bg-success-500/10 px-3 py-1.5 text-center text-[10px] font-medium text-success-400 ring-1 ring-inset ring-success-500/20">Hired</div>
                      </div>
                    </div>

                    <!-- Team -->
                    <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                      <div class="mb-3 flex items-center justify-between">
                        <span class="text-[11px] font-semibold tracking-wider text-surface-500 uppercase">Your Desk</span>
                        <span class="text-[10px] text-surface-500">Shared visibility</span>
                      </div>
                      <div class="space-y-2">
                        <div class="flex items-center gap-2.5">
                          <div class="flex h-6 w-6 items-center justify-center rounded-full bg-brand-500/20 text-[9px] font-bold text-brand-300">HK</div>
                          <span class="text-[12px] text-surface-300">hermon@myrecruiter.uk</span>
                          <span class="ml-auto rounded-full bg-brand-500/10 px-2 py-0.5 text-[9px] font-medium text-brand-400">Founder</span>
                        </div>
                        <div class="flex items-center gap-2.5">
                          <div class="flex h-6 w-6 items-center justify-center rounded-full bg-accent-500/20 text-[9px] font-bold text-accent-300">YO</div>
                          <span class="text-[12px] text-surface-300">you@myrecruiter.uk</span>
                          <span class="ml-auto rounded-full bg-white/[0.06] px-2 py-0.5 text-[9px] font-medium text-surface-400">Recruiter</span>
                        </div>
                        <div class="flex items-center gap-2.5 text-surface-600">
                          <div class="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-white/[0.1] text-[9px]">+</div>
                          <span class="text-[12px]">The next hire...</span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Text -->
                <div class="order-1 flex flex-col justify-center p-8 sm:p-10 lg:order-2">
                  <div class="mb-4 sm:hidden">
                    <span class="how-step-number-accent text-xs font-bold">STEP 02</span>
                  </div>
                  <h3 class="text-xl font-bold tracking-tight text-white sm:text-2xl">Run the pipeline</h3>
                  <p class="mt-3 text-[15px] leading-relaxed text-surface-400">
                    Move candidates through first and second interviews with prepped calls,
                    structured debriefs and reference checks.
                    <span class="font-medium text-surface-300">Every stage shows the next action</span> — nothing relies on memory.
                  </p>
                  <div class="mt-5 flex flex-wrap gap-2">
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-surface-300">
                      <Phone class="h-3 w-3 text-accent-400" :stroke-width="2" />
                      Prepped calls
                    </span>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-surface-300">
                      <Settings class="h-3 w-3 text-surface-400" :stroke-width="2" />
                      Structured debriefs
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- ── Step 3: Hire ───────────────────────────── -->
          <div class="stagger-child relative mt-6 sm:mt-10 sm:pl-20">
            <!-- Timeline node -->
            <div class="absolute top-0 left-0 hidden sm:block" aria-hidden="true">
              <div class="relative flex h-12 w-12 items-center justify-center">
                <div class="absolute inset-0 rounded-full bg-success-500/10 blur-md" />
                <div class="relative flex h-12 w-12 items-center justify-center rounded-full border border-success-500/30 bg-[#0c0c0f]">
                  <span class="how-step-number-success text-sm font-bold">03</span>
                </div>
              </div>
            </div>

            <!-- Content + Visual -->
            <div class="group overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0c0c0f] transition-all duration-500 hover:border-white/[0.12]">
              <div class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100" aria-hidden="true">
                <div class="absolute -bottom-24 -left-16 h-52 w-52 rounded-full bg-success-500/[0.06] blur-[100px]" />
              </div>

              <div class="relative grid gap-0 lg:grid-cols-[1fr,1.2fr]">
                <!-- Text -->
                <div class="flex flex-col justify-center p-8 sm:p-10">
                  <div class="mb-4 sm:hidden">
                    <span class="how-step-number-success text-xs font-bold">STEP 03</span>
                  </div>
                  <h3 class="text-xl font-bold tracking-tight text-white sm:text-2xl">Close, onboard, collect</h3>
                  <p class="mt-3 text-[15px] leading-relaxed text-surface-400">
                    Manage offers, resignation and counter-offer risk, pre-start follow-ups and invoicing.
                    <span class="font-medium text-surface-300">The placement isn't finished until the fee is collected</span>.
                  </p>
                  <div class="mt-5 flex flex-wrap gap-2">
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-surface-300">
                      <Briefcase class="h-3 w-3 text-warning-400" :stroke-width="2" />
                      Offer management
                    </span>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-surface-300">
                      <ShieldCheck class="h-3 w-3 text-surface-400" :stroke-width="2" />
                      Counter-offer prep
                    </span>
                    <span class="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/[0.03] px-3 py-1 text-[11px] font-medium text-surface-300">
                      <FileText class="h-3 w-3 text-surface-400" :stroke-width="2" />
                      Invoice to collection
                    </span>
                  </div>
                </div>

                <!-- Hiring dashboard mockup -->
                <div class="relative border-t border-white/[0.06] bg-[#0a0a0d] p-5 sm:p-6 lg:border-t-0 lg:border-l">
                  <div class="space-y-3">
                    <!-- Active job -->
                    <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2.5">
                          <Briefcase class="h-3.5 w-3.5 text-brand-400" :stroke-width="1.75" />
                          <span class="text-[13px] font-semibold text-white">Head of Quality — Life Sciences</span>
                        </div>
                        <span class="rounded-full bg-success-500/10 px-2 py-0.5 text-[10px] font-medium text-success-400">Offer stage</span>
                      </div>
                      <!-- Mini pipeline -->
                      <div class="mt-3 flex h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                        <div class="h-full bg-warning-500/80" style="width: 35%" />
                        <div class="h-full bg-info-500/80" style="width: 20%" />
                        <div class="h-full bg-brand-500/80" style="width: 30%" />
                        <div class="h-full bg-success-500/80" style="width: 15%" />
                      </div>
                      <div class="mt-2 flex gap-3 text-[10px] text-surface-500">
                        <span>6 longlist</span>
                        <span>3 first interview</span>
                        <span>2 second</span>
                        <span>1 offer</span>
                      </div>
                    </div>

                    <!-- Recent candidates -->
                    <div class="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3.5">
                      <div class="mb-2.5 text-[11px] font-semibold tracking-wider text-surface-500 uppercase">Recent Candidates</div>
                      <div class="space-y-2">
                        <div class="flex items-center gap-3 rounded-md bg-white/[0.02] px-3 py-2">
                          <div class="flex h-7 w-7 items-center justify-center rounded-full bg-brand-500/20 text-[9px] font-bold text-brand-300">JD</div>
                          <div class="flex-1">
                            <div class="text-[12px] font-medium text-white">Jane Doe</div>
                            <div class="text-[10px] text-surface-500">Head of Quality — Life Sciences</div>
                          </div>
                          <span class="rounded-full bg-brand-500/10 px-2 py-0.5 text-[10px] font-medium text-brand-400">2nd interview</span>
                        </div>
                        <div class="flex items-center gap-3 rounded-md px-3 py-2">
                          <div class="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500/20 text-[9px] font-bold text-accent-300">AK</div>
                          <div class="flex-1">
                            <div class="text-[12px] font-medium text-white">Alex Kim</div>
                            <div class="text-[10px] text-surface-500">Regulatory Affairs Director</div>
                          </div>
                          <span class="rounded-full bg-warning-500/10 px-2 py-0.5 text-[10px] font-medium text-warning-400">Longlist</span>
                        </div>
                        <div class="flex items-center gap-3 rounded-md px-3 py-2">
                          <div class="flex h-7 w-7 items-center justify-center rounded-full bg-warning-500/20 text-[9px] font-bold text-warning-300">MS</div>
                          <div class="flex-1">
                            <div class="text-[12px] font-medium text-white">Maria Silva</div>
                            <div class="text-[10px] text-surface-500">Grid Connections Manager</div>
                          </div>
                          <span class="rounded-full bg-accent-500/10 px-2 py-0.5 text-[10px] font-medium text-accent-400">Offer</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <!-- Bottom fade -->
                  <div class="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-[#0a0a0d] to-transparent" />
                </div>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>

    <!-- ─── Tech Stack ─────────────────────────────────── -->
    <section ref="techStackRef" class="scroll-fade relative overflow-hidden border-t border-white/[0.06] py-24 sm:py-32">
      <!-- Ambient glow orbs -->
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div class="absolute top-1/3 left-1/4 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500/[0.04] blur-[160px]" />
        <div class="absolute right-1/4 bottom-1/3 h-[400px] w-[400px] translate-x-1/2 translate-y-1/2 rounded-full bg-[#00DC82]/[0.03] blur-[140px]" />
      </div>

      <div class="relative mx-auto max-w-6xl px-6">
        <div class="mx-auto max-w-2xl text-center">
          <p class="text-sm font-semibold tracking-[0.2em] text-brand-400 uppercase">The Foundations</p>
          <h2 class="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Fast, secure and always on
          </h2>
          <p class="mt-4 text-base leading-relaxed text-surface-400 sm:text-lg">
            The platform runs on our own secure infrastructure with encrypted connections and
            role-based access. Candidate data is handled GDPR-consciously and never leaves our control.
          </p>
        </div>

        <div class="mx-auto mt-16 grid max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <!-- Nuxt 4 -->
          <div class="tech-card stagger-child group relative overflow-hidden rounded-2xl">
            <div class="tech-card-border" />
            <div class="relative flex items-start gap-4 p-6">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#00DC82]/10 ring-1 ring-inset ring-[#00DC82]/20 transition-all duration-300 group-hover:bg-[#00DC82]/15 group-hover:ring-[#00DC82]/30 group-hover:shadow-[0_0_20px_rgba(0,220,130,0.1)]">
                <svg class="h-5 w-5" viewBox="0 0 400 400" fill="none">
                  <path d="M227.3 321.7H354c4.5 0 8.9-1.2 12.7-3.5 3.9-2.3 7-5.5 9.2-9.4 2.1-3.9 3.2-8.2 3.1-12.6-.1-4.4-1.4-8.7-3.7-12.4L281 122.6c-2.2-3.8-5.4-6.9-9.2-9.1-3.8-2.2-8.1-3.4-12.5-3.4s-8.7 1.2-12.5 3.4c-3.8 2.2-7 5.3-9.2 9.1l-10.3 17.8-20.2-34.8c-2.3-3.8-5.5-7-9.4-9.2-3.9-2.2-8.2-3.4-12.7-3.4-4.4 0-8.8 1.2-12.7 3.4-3.9 2.2-7.1 5.3-9.4 9.2L46.7 283.8c-2.3 3.8-3.5 8-3.6 12.4-.1 4.4 1 8.7 3.1 12.6 2.1 3.9 5.3 7.1 9.2 9.4 3.9 2.3 8.3 3.5 12.7 3.5h79.9c35.3 0 61.4-15.4 79.3-45.8l53.2-91.7-20.1-34.7-63.3 109.2c-13 22-28.7 29.4-52.7 29.4H88.2l97-167.6 48.3 83.4-26.5 45.6 20.3 35z" fill="#00DC82"/>
                </svg>
              </div>
              <div class="min-w-0">
                <h3 class="text-[15px] font-semibold text-white">Nuxt 4</h3>
                <p class="mt-1 text-[13px] leading-relaxed text-surface-500">A modern interface that stays fast with thousands of candidates and notes.</p>
              </div>
            </div>
          </div>

          <!-- PostgreSQL -->
          <div class="tech-card stagger-child group relative overflow-hidden rounded-2xl">
            <div class="tech-card-border" />
            <div class="relative flex items-start gap-4 p-6">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#336791]/10 ring-1 ring-inset ring-[#336791]/20 transition-all duration-300 group-hover:bg-[#336791]/15 group-hover:ring-[#336791]/30 group-hover:shadow-[0_0_20px_rgba(51,103,145,0.1)]">
                <img src="/database-icon.png" alt="Database" class="h-5 w-5 object-contain" />
              </div>
              <div class="min-w-0">
                <h3 class="text-[15px] font-semibold text-white">PostgreSQL</h3>
                <p class="mt-1 text-[13px] leading-relaxed text-surface-500">Every candidate, client and note in one rock-solid system of record.</p>
              </div>
            </div>
          </div>

          <!-- Drizzle ORM -->
          <div class="tech-card stagger-child group relative overflow-hidden rounded-2xl">
            <div class="tech-card-border" />
            <div class="relative flex items-start gap-4 p-6">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#C5F74F]/10 ring-1 ring-inset ring-[#C5F74F]/20 transition-all duration-300 group-hover:bg-[#C5F74F]/15 group-hover:ring-[#C5F74F]/30 group-hover:shadow-[0_0_20px_rgba(197,247,79,0.08)]">
                <Droplets class="h-5 w-5 text-[#C5F74F]" :stroke-width="1.5" />
              </div>
              <div class="min-w-0">
                <h3 class="text-[15px] font-semibold text-white">Drizzle ORM</h3>
                <p class="mt-1 text-[13px] leading-relaxed text-surface-500">Reliable data handling — no lost notes, no corrupted records.</p>
              </div>
            </div>
          </div>

          <!-- Better Auth -->
          <div class="tech-card stagger-child group relative overflow-hidden rounded-2xl">
            <div class="tech-card-border" />
            <div class="relative flex items-start gap-4 p-6">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] ring-1 ring-inset ring-white/[0.08] transition-all duration-300 group-hover:bg-white/[0.08] group-hover:ring-white/[0.14] group-hover:shadow-[0_0_20px_rgba(255,255,255,0.04)]">
                <KeyRound class="h-5 w-5 text-surface-300" :stroke-width="1.5" />
              </div>
              <div class="min-w-0">
                <h3 class="text-[15px] font-semibold text-white">Better Auth</h3>
                <p class="mt-1 text-[13px] leading-relaxed text-surface-500">Secure sign-in with role-based access for founders, recruiters and guests.</p>
              </div>
            </div>
          </div>

          <!-- MinIO / S3 -->
          <div class="tech-card stagger-child group relative overflow-hidden rounded-2xl">
            <div class="tech-card-border" />
            <div class="relative flex items-start gap-4 p-6">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#C72C48]/10 ring-1 ring-inset ring-[#C72C48]/20 transition-all duration-300 group-hover:bg-[#C72C48]/15 group-hover:ring-[#C72C48]/30 group-hover:shadow-[0_0_20px_rgba(199,44,72,0.1)]">
                <HardDrive class="h-5 w-5 text-[#C72C48]" :stroke-width="1.5" />
              </div>
              <div class="min-w-0">
                <h3 class="text-[15px] font-semibold text-white">MinIO / S3</h3>
                <p class="mt-1 text-[13px] leading-relaxed text-surface-500">CVs and documents stored on our own private infrastructure, not a third-party cloud.</p>
              </div>
            </div>
          </div>

          <!-- Docker -->
          <div class="tech-card stagger-child group relative overflow-hidden rounded-2xl">
            <div class="tech-card-border" />
            <div class="relative flex items-start gap-4 p-6">
              <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#2496ED]/10 ring-1 ring-inset ring-[#2496ED]/20 transition-all duration-300 group-hover:bg-[#2496ED]/15 group-hover:ring-[#2496ED]/30 group-hover:shadow-[0_0_20px_rgba(36,150,237,0.1)]">
                <Container class="h-5 w-5 text-[#2496ED]" :stroke-width="1.5" />
              </div>
              <div class="min-w-0">
                <h3 class="text-[15px] font-semibold text-white">Docker</h3>
                <p class="mt-1 text-[13px] leading-relaxed text-surface-500">Runs as a monitored, always-on service with automatic restarts.</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── Coming Soon: 30-Step Process ──────────────── -->
    <section id="coming-soon" ref="roadmapRef" class="scroll-fade relative overflow-hidden border-t border-white/[0.06] py-24 sm:py-32">
      <!-- Glow -->
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div class="absolute top-1/2 left-1/4 h-[500px] w-[600px] -translate-y-1/2 rounded-full bg-success-500/[0.04] blur-[150px]" />
        <div class="absolute top-1/2 right-1/4 h-[400px] w-[500px] -translate-y-1/2 rounded-full bg-purple-500/[0.04] blur-[130px]" />
      </div>

      <div class="relative mx-auto max-w-6xl px-6">
        <div class="mx-auto max-w-2xl text-center">
          <p class="text-sm font-semibold tracking-[0.2em] text-brand-400 uppercase">Coming Soon</p>
          <h2 class="mt-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            The 30-Step Recruitment Process, built in
          </h2>
          <p class="mt-4 text-base leading-relaxed text-surface-400 sm:text-lg">
            Our proprietary full-cycle methodology — thirty defined steps from first call to
            cash collected — is being integrated directly into the platform. Every live job will
            show exactly where it sits, what's next, and what's at risk.
            New recruiters ramp in weeks, not quarters.
          </p>
        </div>

        <!-- 5 phases -->
        <div class="mt-16 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <!-- Phase 1 -->
          <div class="stagger-child rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold tracking-widest text-brand-400 uppercase">Phase 1 · Steps 1–6</span>
            </div>
            <h3 class="mt-2 text-[15px] font-semibold text-white">Intake &amp; Sourcing</h3>
            <p class="mt-1 text-[12px] leading-relaxed text-surface-500">Win the brief properly and build a search that can actually deliver.</p>
            <ul class="mt-4 space-y-1.5 text-[11px] text-surface-400">
              <li class="flex gap-2"><span class="text-brand-400/60">01</span> Complete job order</li>
              <li class="flex gap-2"><span class="text-brand-400/60">02</span> Recruiting plan</li>
              <li class="flex gap-2"><span class="text-brand-400/60">03</span> File search</li>
              <li class="flex gap-2"><span class="text-brand-400/60">04</span> Name gathering</li>
              <li class="flex gap-2"><span class="text-brand-400/60">05</span> Candidate contact / cold sourcing call</li>
              <li class="flex gap-2"><span class="text-brand-400/60">06</span> Candidate profile</li>
            </ul>
          </div>

          <!-- Phase 2 -->
          <div class="stagger-child rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold tracking-widest text-accent-400 uppercase">Phase 2 · Steps 7–12</span>
            </div>
            <h3 class="mt-2 text-[15px] font-semibold text-white">Introduction &amp; Initial Selection</h3>
            <p class="mt-1 text-[12px] leading-relaxed text-surface-500">Present only candidates worth your client's time — both sides fully prepped.</p>
            <ul class="mt-4 space-y-1.5 text-[11px] text-surface-400">
              <li class="flex gap-2"><span class="text-accent-400/60">07</span> Candidate presentation to employer</li>
              <li class="flex gap-2"><span class="text-accent-400/60">08</span> First interview setup</li>
              <li class="flex gap-2"><span class="text-accent-400/60">09</span> First interview candidate prep</li>
              <li class="flex gap-2"><span class="text-accent-400/60">10</span> Employer interview prep</li>
              <li class="flex gap-2"><span class="text-accent-400/60">11</span> Candidate debrief</li>
              <li class="flex gap-2"><span class="text-accent-400/60">12</span> Employer debrief</li>
            </ul>
          </div>

          <!-- Phase 3 -->
          <div class="stagger-child rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold tracking-widest text-warning-400 uppercase">Phase 3 · Steps 13–19</span>
            </div>
            <h3 class="mt-2 text-[15px] font-semibold text-white">Deep Evaluation</h3>
            <p class="mt-1 text-[12px] leading-relaxed text-surface-500">Test intent as hard as credentials — trial closes, references and honest debriefs.</p>
            <ul class="mt-4 space-y-1.5 text-[11px] text-surface-400">
              <li class="flex gap-2"><span class="text-warning-400/60">13</span> Second interview setup</li>
              <li class="flex gap-2"><span class="text-warning-400/60">14</span> Reference check</li>
              <li class="flex gap-2"><span class="text-warning-400/60">15</span> Second interview candidate prep / trial close</li>
              <li class="flex gap-2"><span class="text-warning-400/60">16</span> Second interview employer prep / trial close</li>
              <li class="flex gap-2"><span class="text-warning-400/60">17</span> Confirm second interview</li>
              <li class="flex gap-2"><span class="text-warning-400/60">18</span> Candidate debrief / closing</li>
              <li class="flex gap-2"><span class="text-warning-400/60">19</span> Employer debrief / hiring intent</li>
            </ul>
          </div>

          <!-- Phase 4 -->
          <div class="stagger-child rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold tracking-widest text-success-400 uppercase">Phase 4 · Steps 20–26</span>
            </div>
            <h3 class="mt-2 text-[15px] font-semibold text-white">Offer &amp; Onboarding</h3>
            <p class="mt-1 text-[12px] leading-relaxed text-surface-500">Control the most dangerous stage: offers, resignations and counter-offers.</p>
            <ul class="mt-4 space-y-1.5 text-[11px] text-surface-400">
              <li class="flex gap-2"><span class="text-success-400/60">20</span> Closing / negotiating</li>
              <li class="flex gap-2"><span class="text-success-400/60">21</span> Offer / acceptance / start date</li>
              <li class="flex gap-2"><span class="text-success-400/60">22</span> Resignation prep</li>
              <li class="flex gap-2"><span class="text-success-400/60">23</span> Counter-offer prep</li>
              <li class="flex gap-2"><span class="text-success-400/60">24</span> Relocation prep if applicable</li>
              <li class="flex gap-2"><span class="text-success-400/60">25</span> Client pre-start follow-up</li>
              <li class="flex gap-2"><span class="text-success-400/60">26</span> Candidate pre-start follow-up</li>
            </ul>
          </div>

          <!-- Phase 5 -->
          <div class="stagger-child rounded-2xl border border-white/[0.08] bg-white/[0.02] p-6">
            <div class="flex items-center justify-between">
              <span class="text-[10px] font-bold tracking-widest text-purple-400 uppercase">Phase 5 · Steps 27–30</span>
            </div>
            <h3 class="mt-2 text-[15px] font-semibold text-white">Administration &amp; Retention</h3>
            <p class="mt-1 text-[12px] leading-relaxed text-surface-500">Protect the fee: confirmations, invoicing, day-one care, collection.</p>
            <ul class="mt-4 space-y-1.5 text-[11px] text-surface-400">
              <li class="flex gap-2"><span class="text-purple-400/60">27</span> Start-date confirmation</li>
              <li class="flex gap-2"><span class="text-purple-400/60">28</span> Invoicing / billing</li>
              <li class="flex gap-2"><span class="text-purple-400/60">29</span> Day-one post-placement follow-up</li>
              <li class="flex gap-2"><span class="text-purple-400/60">30</span> Collection / payment secured</li>
            </ul>
          </div>

          <!-- Closing card -->
          <div class="stagger-child flex flex-col justify-center rounded-2xl border border-brand-500/[0.15] bg-brand-500/[0.04] p-6">
            <p class="text-[15px] font-semibold leading-relaxed text-white">
              Thirty steps. No gaps.
            </p>
            <p class="mt-2 text-[13px] leading-relaxed text-surface-400">
              From first call to fee collected — the same process, the same standards, on every
              single placement. You'll be the first to know when it goes live.
            </p>
          </div>
        </div>
      </div>
    </section>

    <!-- ─── CTA ────────────────────────────────────────── -->
    <section ref="ctaRef" class="scroll-fade relative overflow-hidden border-t border-white/[0.06] py-24 sm:py-32">
      <!-- Glow -->
      <div class="pointer-events-none absolute inset-0" aria-hidden="true">
        <div class="absolute bottom-0 left-1/2 h-[400px] w-[700px] -translate-x-1/2 translate-y-1/2 rounded-full bg-brand-500/[0.06] blur-[120px]" />
      </div>

      <div class="relative mx-auto max-w-3xl px-6 text-center">
        <div class="mb-8 flex justify-center">
          <img
            src="/myrecruiter-icon-128.png"
            alt="MyRecruiter logo"
            class="h-20 w-20 object-contain drop-shadow-[0_0_40px_rgba(59,130,246,0.5)]"
          />
        </div>
        <h2 class="text-3xl font-bold tracking-tight text-white sm:text-4xl lg:text-5xl">
          Ready to work your desk?
        </h2>
        <p class="mx-auto mt-5 max-w-lg text-base leading-relaxed text-surface-400 sm:text-lg">
          Join the agency and get your own pipeline, your own candidates,
          and a process that's already proven. Log in and take your first job order.
        </p>
        <div class="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <NuxtLink
            :to="$localePath('/auth/sign-up')"
            class="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-[#09090b] shadow-[0_0_20px_rgba(255,255,255,0.1)] transition hover:bg-white/90 hover:shadow-[0_0_30px_rgba(255,255,255,0.15)]"
          >
            Get started
            <ArrowRight class="h-3.5 w-3.5" />
          </NuxtLink>
          <NuxtLink
            :to="$localePath('/auth/sign-in?live=1')"
            class="inline-flex items-center gap-2 rounded-lg border border-white/[0.1] bg-white/[0.03] px-5 py-2.5 text-sm font-semibold text-surface-300 transition hover:border-white/[0.2] hover:bg-white/[0.06] hover:text-white"
          >
            <Play class="h-4 w-4" />
            Try the live demo
          </NuxtLink>
        </div>
      </div>
    </section>

    <!-- ─── Footer ─────────────────────────────────────── -->
    <footer class="border-t border-white/[0.06] py-8">
      <div class="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div class="flex items-center gap-2 text-[13px] text-surface-500">
          <img src="/myrecruiter-icon-128.png" alt="MyRecruiter logo" class="h-5 w-5 object-contain" />
          &copy; {{ new Date().getFullYear() }} MyRecruiter. The desk platform for perm recruiters who do it properly.
        </div>
        <div class="flex gap-6 text-[13px] text-surface-500">
          <a href="#coming-soon" class="transition hover:text-white">
            The 30 Steps
          </a>
          <NuxtLink :to="$localePath('/jobs')" class="transition hover:text-white">
            Open Positions
          </NuxtLink>
          <NuxtLink :to="$localePath('/auth/sign-in')" class="transition hover:text-white">
            Sign in
          </NuxtLink>
        </div>
      </div>
    </footer>
  </div>
</template>
