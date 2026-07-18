<script lang="ts">
  import '../app.css';
  import { toastMessage } from '$lib/stores/toast';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { afterNavigate } from '$app/navigation';
  import { captureAcq } from '$lib/utils/acq';
  import { unreadCount, refreshUnread } from '$lib/stores/notifications';

  let { children } = $props();

  // Remember how this device first arrived (first-party, cookieless) so a game
  // opened later can be attributed to its source. Runs once, on the entry page.
  onMount(() => captureAcq($page.url.pathname, $page.url.search));
  let user = $derived($page.data?.user ?? null);

  // Keep the notification badge fresh: on load and after every navigation
  // (visiting /notifications marks them read, so leaving it clears the badge).
  onMount(() => refreshUnread(!!$page.data?.user));
  afterNavigate(() => refreshUnread(!!$page.data?.user));

  // Add-to-home-screen nudge (Android/Chrome fire beforeinstallprompt; iOS uses
  // the native Share → Add to Home Screen, no prompt to catch). Only nudge people
  // who've actually used it (≥1 game) and haven't dismissed it. No service worker.
  let installEvent = $state<any>(null);
  let showInstall = $state(false);
  onMount(() => {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', (e: any) => {
      e.preventDefault();
      let played = false;
      try { played = (JSON.parse(localStorage.getItem('pc_games') || '[]') || []).length > 0; } catch { /* ignore */ }
      if (!played || localStorage.getItem('pc_install_dismissed')) return;
      installEvent = e;
      showInstall = true;
    });
  });
  async function doInstall() {
    showInstall = false;
    if (installEvent) { installEvent.prompt(); try { await installEvent.userChoice; } catch { /* dismissed */ } installEvent = null; }
  }
  function dismissInstall() { showInstall = false; try { localStorage.setItem('pc_install_dismissed', '1'); } catch { /* ignore */ } }
  let initial = $derived(user ? (user.displayName || '?').charAt(0).toUpperCase() : '');

  // Per-page social preview: a route's load() can return `meta: {title, description}`
  // (e.g. the game page names the winners) and it flows into the og/twitter tags
  // here — one source of truth, no double-emitted tags.
  const DEF_DESC = 'Everyone at the table sees their own money — join with one code. potcount tracks every buy-in and works out who pays who. Free, nothing to install.';
  let meta = $derived($page.data?.meta ?? null);
  let ogTitle = $derived(meta?.title ?? 'potcount — poker home game tracker');
  let ogDesc = $derived(meta?.description ?? DEF_DESC);

  // Active-tab highlighting for the bottom nav (phones).
  let path = $derived($page.url.pathname);
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
</script>

<svelte:head>
  <!-- Falls back to the brand, but a route's load() meta.title (e.g. a city page's
       "Home poker games in Amsterdam") becomes the real <title>. Pages that set
       their own <title> still override this via SvelteKit head dedupe. -->
  <title>{ogTitle}</title>
  <!-- Site-wide SEO + social defaults. Here (in <svelte:head>) rather than in the
       static app.html so a page that sets its own og/description OVERRIDES these
       instead of double-emitting them — SvelteKit dedupes <svelte:head> tags. -->
  <meta name="description" content={ogDesc} />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="potcount" />
  <meta property="og:title" content={ogTitle} />
  <meta property="og:description" content={ogDesc} />
  <meta property="og:url" content={$page.url.href} />
  <meta property="og:image" content="https://potcount.com/og.png?v=3" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="potcount — track buy-ins at your poker night" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={ogTitle} />
  <meta name="twitter:description" content={ogDesc} />
  <meta name="twitter:image" content="https://potcount.com/og.png?v=3" />
</svelte:head>

<!-- Topbar -->
<nav class="topbar">
  <a href="/" class="font-bold text-[1.15rem] tracking-tight no-underline text-text font-display">
    pot<span class="text-accent">count</span>
  </a>
  <div class="flex items-center gap-2">
  {#if user}
    <a href="/notifications" class="relative pill !px-2.5 no-underline hover:text-text hover:border-text/20 transition-colors" title="Notifications" aria-label="Notifications{$unreadCount > 0 ? ` (${$unreadCount} unread)` : ''}">
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="shrink-0">
        <path d="M10 2.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2-1 4.6-1.6 5.3-.3.3-.1.9.4.9h11.4c.5 0 .7-.6.4-.9-.6-.7-1.6-2.1-1.6-5.3A4.5 4.5 0 0 0 10 2.5Z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
        <path d="M8.2 16a1.9 1.9 0 0 0 3.6 0" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
      {#if $unreadCount > 0}
        <span class="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-accent text-accent-ink text-[10px] font-bold grid place-items-center leading-none tabular-nums">{$unreadCount > 9 ? '9+' : $unreadCount}</span>
      {/if}
    </a>
  {/if}
  <!-- On phones these move to the bottom nav; desktop keeps them up here. -->
  <div class="hidden sm:flex items-center gap-2">
    <a href="/pot" class="pill gap-[7px] pl-[9px] hover:text-accent hover:border-accent/45 no-underline transition-colors">
      <svg width="17" height="17" viewBox="0 0 20 20" fill="none" aria-hidden="true" class="shrink-0" style="filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))">
        <rect x="2.6" y="5.2" width="8.4" height="11.6" rx="2" transform="rotate(-11 6.8 11)" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.3"/>
        <rect x="8.6" y="3.4" width="8.4" height="11.6" rx="2" transform="rotate(10 12.8 9.2)" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.3"/>
        <path d="M12.8 7.4l1.1 1.9-1.1 1.9-1.1-1.9z" fill="currentColor"/>
      </svg>
      Split
    </a>
    <a href="/feed" class="pill gap-[6px] hover:text-text hover:border-text/20 no-underline transition-colors">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true" class="shrink-0">
        <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
      </svg>
      Feed
    </a>
    {#if user}
      <a href="/account" class="pill gap-2 pl-1 no-underline hover:text-text transition-colors" title="@{user.handle}">
        {#if user.avatar}
          <img src={user.avatar} alt="" referrerpolicy="no-referrer"
               class="w-6 h-6 rounded-full object-cover shrink-0" style="box-shadow: 0 0 0 1px rgba(0,0,0,.28);" />
        {:else}
          <span class="relative w-6 h-6 rounded-full grid place-items-center text-[.72rem] font-extrabold text-accent-ink shrink-0"
                style="font-family: var(--font-display); background: radial-gradient(circle at 50% 34%, #cf5a68, var(--color-accent) 60%, #5f1420); box-shadow: inset 0 0 0 2px rgba(30,8,12,.38), 0 0 0 1px rgba(0,0,0,.28), 0 0 10px rgba(154,30,48,.42);">
            {initial}
          </span>
        {/if}
        {user.displayName}
      </a>
    {:else}
      <a href="/account" class="pill no-underline hover:text-text transition-colors">Sign in</a>
    {/if}
  </div>
  </div>
</nav>

<!-- Content -->
{@render children()}

<!-- Bottom nav — phones only (thumb reach). Desktop uses the top bar above. -->
<nav class="botnav" aria-label="Primary">
  <a href="/" class="botnav-item {isActive('/') ? 'is-active' : ''}" aria-current={isActive('/') ? 'page' : undefined}>
    <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 11.4 12 4l9 7.4M5.6 9.8v9.7h12.8V9.8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
    <span>Home</span>
  </a>
  <a href="/pot" class="botnav-item {isActive('/pot') ? 'is-active' : ''}" aria-current={isActive('/pot') ? 'page' : undefined}>
    <svg width="22" height="22" viewBox="0 0 20 20" fill="none" aria-hidden="true" style="filter:drop-shadow(0 1px 1px rgba(0,0,0,.35))">
      <rect x="2.6" y="5.2" width="8.4" height="11.6" rx="2" transform="rotate(-11 6.8 11)" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.3"/>
      <rect x="8.6" y="3.4" width="8.4" height="11.6" rx="2" transform="rotate(10 12.8 9.2)" fill="var(--color-surface)" stroke="currentColor" stroke-width="1.3"/>
      <path d="M12.8 7.4l1.1 1.9-1.1 1.9-1.1-1.9z" fill="currentColor"/>
    </svg>
    <span>Split</span>
  </a>
  <a href="/feed" class="botnav-item {isActive('/feed') ? 'is-active' : ''}" aria-current={isActive('/feed') ? 'page' : undefined}>
    <svg width="20" height="20" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4h12M2 8h8M2 12h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    </svg>
    <span>Feed</span>
  </a>
  <a href="/account" class="botnav-item {isActive('/account') ? 'is-active' : ''}" aria-current={isActive('/account') ? 'page' : undefined}>
    {#if user?.avatar}
      <img src={user.avatar} alt="" referrerpolicy="no-referrer"
           class="w-[22px] h-[22px] rounded-full object-cover" style="box-shadow: 0 0 0 1px rgba(0,0,0,.28);" />
    {:else if user}
      <span class="w-[22px] h-[22px] rounded-full grid place-items-center text-[.66rem] font-extrabold text-accent-ink"
            style="font-family: var(--font-display); background: radial-gradient(circle at 50% 34%, #cf5a68, var(--color-accent) 60%, #5f1420); box-shadow: inset 0 0 0 2px rgba(30,8,12,.38), 0 0 0 1px rgba(0,0,0,.28);">{initial}</span>
    {:else}
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="1.6"/>
        <path d="M5.6 19.4a6.4 6.4 0 0 1 12.8 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    {/if}
    <span>{user ? 'You' : 'Sign in'}</span>
  </a>
</nav>

<!-- Add-to-home-screen nudge (Android/Chrome) -->
{#if showInstall}
  <div class="fixed left-3 right-3 z-[150] bottom-[calc(72px+env(safe-area-inset-bottom))] sm:bottom-[calc(20px+env(safe-area-inset-bottom))] sm:left-auto sm:right-4 sm:max-w-sm">
    <div class="card !bg-surface-2 !border-accent/30 flex items-center gap-3 shadow-xl">
      <span class="text-sm flex-1">Add <b>potcount</b> to your home screen for one-tap access.</span>
      <button class="btn-small btn shrink-0" onclick={doInstall}>Install</button>
      <button class="text-faint hover:text-text p-1 -m-1 shrink-0" aria-label="Dismiss" onclick={dismissInstall}>✕</button>
    </div>
  </div>
{/if}

<!-- Toast — sits above the bottom nav on phones -->
{#if $toastMessage}
  <div class="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] sm:bottom-[calc(20px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-surface-3 border border-border text-text px-[18px] py-[11px] rounded-full text-[.9rem] font-medium z-[200] shadow-xl max-w-[min(90%,480px)]"
       role="status">
    {$toastMessage}
  </div>
{/if}
