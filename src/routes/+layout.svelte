<script lang="ts">
  import '../app.css';
  import { toastMessage } from '$lib/stores/toast';
  import { page } from '$app/stores';
  import { onMount } from 'svelte';
  import { captureAcq } from '$lib/utils/acq';

  let { children } = $props();

  // Remember how this device first arrived (first-party, cookieless) so a game
  // opened later can be attributed to its source. Runs once, on the entry page.
  onMount(() => captureAcq($page.url.pathname, $page.url.search));
  let user = $derived($page.data?.user ?? null);
  let initial = $derived(user ? (user.displayName || '?').charAt(0).toUpperCase() : '');

  // Active-tab highlighting for the bottom nav (phones).
  let path = $derived($page.url.pathname);
  const isActive = (href: string) => (href === '/' ? path === '/' : path.startsWith(href));
</script>

<svelte:head>
  <title>potcount</title>
</svelte:head>

<!-- Topbar -->
<nav class="topbar">
  <a href="/" class="font-bold text-[1.15rem] tracking-tight no-underline text-text" style="font-family: var(--font-display)">
    pot<span class="text-accent">count</span>
  </a>
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
                style="font-family: var(--font-display); background: radial-gradient(circle at 50% 34%, #f0a47a, var(--color-accent) 60%, #a85a3a); box-shadow: inset 0 0 0 2px rgba(40,16,6,.38), 0 0 0 1px rgba(0,0,0,.28), 0 0 10px rgba(218,119,86,.42);">
            {initial}
          </span>
        {/if}
        {user.displayName}
      </a>
    {:else}
      <a href="/account" class="pill no-underline hover:text-text transition-colors">Sign in</a>
    {/if}
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
            style="font-family: var(--font-display); background: radial-gradient(circle at 50% 34%, #f0a47a, var(--color-accent) 60%, #a85a3a); box-shadow: inset 0 0 0 2px rgba(40,16,6,.38), 0 0 0 1px rgba(0,0,0,.28);">{initial}</span>
    {:else}
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="8" r="3.4" stroke="currentColor" stroke-width="1.6"/>
        <path d="M5.6 19.4a6.4 6.4 0 0 1 12.8 0" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      </svg>
    {/if}
    <span>{user ? 'You' : 'Sign in'}</span>
  </a>
</nav>

<!-- Toast — sits above the bottom nav on phones -->
{#if $toastMessage}
  <div class="fixed bottom-[calc(84px+env(safe-area-inset-bottom))] sm:bottom-[calc(20px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-surface-3 border border-border text-text px-[18px] py-[11px] rounded-full text-[.9rem] font-medium z-[200] shadow-xl max-w-[min(90%,480px)]"
       role="status">
    {$toastMessage}
  </div>
{/if}
