<script lang="ts">
  import '../app.css';
  import { toastMessage } from '$lib/stores/toast';
  import { page } from '$app/stores';

  let { children } = $props();
  let user = $derived($page.data?.user ?? null);
  let initial = $derived(user ? (user.displayName || '?').charAt(0).toUpperCase() : '');
</script>

<svelte:head>
  <title>potcount</title>
</svelte:head>

<!-- Topbar -->
<nav class="topbar">
  <a href="/" class="font-bold text-[1.15rem] tracking-tight no-underline text-text" style="font-family: var(--font-display)">
    poker<span class="text-accent">count</span>
  </a>
  <div class="flex items-center gap-2">
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
        <span class="relative w-6 h-6 rounded-full grid place-items-center text-[.72rem] font-extrabold text-accent-ink shrink-0"
              style="font-family: var(--font-display); background: radial-gradient(circle at 50% 34%, #66f0bf, var(--color-accent) 60%, #13a276); box-shadow: inset 0 0 0 2px rgba(6,40,28,.38), 0 0 0 1px rgba(0,0,0,.28), 0 0 10px rgba(52,211,153,.42);">
          {initial}
        </span>
        {user.displayName}
      </a>
    {:else}
      <a href="/account" class="pill no-underline hover:text-text transition-colors">Sign in</a>
    {/if}
  </div>
</nav>

<!-- Content -->
{@render children()}

<!-- Toast -->
{#if $toastMessage}
  <div class="fixed bottom-[calc(20px+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 bg-surface-3 border border-border text-text px-[18px] py-[11px] rounded-full text-[.9rem] font-medium z-[200] shadow-xl max-w-[min(90%,480px)]"
       role="status">
    {$toastMessage}
  </div>
{/if}
