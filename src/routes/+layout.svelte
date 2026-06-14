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
    pot<span class="text-accent">count</span>
  </a>
  <div class="flex items-center gap-2">
    <a href="/pot" class="pill hover:text-text hover:border-text/20 no-underline transition-colors">Split</a>
    <a href="/feed" class="pill hover:text-text hover:border-text/20 no-underline transition-colors">Feed</a>
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
