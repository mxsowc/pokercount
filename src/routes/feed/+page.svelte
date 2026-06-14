<script lang="ts">
  import { page } from '$app/stores';
  import { toast } from '$lib/stores/toast';
  import { money, fmtSigned } from '$lib/utils/money';
  import { ago } from '$lib/utils/time';
  import { onMount } from 'svelte';

  let user = $derived($page.data?.user ?? null);
  let items = $state<any[]>([]);
  let loading = $state(true);

  // Search
  let query = $state('');
  let searchResults = $state<any[]>([]);
  let searchOpen = $state(false);
  let searchTimer: ReturnType<typeof setTimeout>;

  onMount(async () => {
    if (!user) { loading = false; return; }
    try {
      const res = await fetch('/api/feed');
      const data = await res.json();
      items = data.items || [];
    } catch {}
    loading = false;
  });

  function onSearch() {
    clearTimeout(searchTimer);
    const q = query.trim();
    if (q.length < 1) { searchOpen = false; return; }
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        searchResults = data.users || [];
        searchOpen = true;
      } catch { searchOpen = false; }
    }, 250);
  }
</script>

<svelte:head><title>potcount — feed</title></svelte:head>

<div class="wrap">
  <h1 class="text-2xl font-bold mb-4">Feed</h1>

  {#if !user}
    <div class="banner banner-info">Sign in to see your feed. <a href="/account">Sign in</a></div>
  {:else}
    <!-- Search -->
    <div class="relative mb-4">
      <input class="input" type="search" bind:value={query} oninput={onSearch} placeholder="Search players by name..."
        autocapitalize="none" autocomplete="off" aria-label="Search players"
        onkeydown={(e) => { if (e.key === 'Escape') { searchOpen = false; e.currentTarget.blur(); } }} />
      {#if searchOpen}
        <div class="absolute top-full left-0 right-0 z-20 bg-surface border border-border rounded-[11px] mt-1 max-h-80 overflow-y-auto shadow-xl">
          {#if searchResults.length === 0}
            <div class="text-muted text-sm p-3">No players found</div>
          {:else}
            {#each searchResults as u (u.id)}
              <a href="/u/{u.handle}" class="flex items-center gap-2.5 p-2.5 px-3.5 no-underline text-text hover:bg-surface-2 transition-colors">
                <span class="w-7 h-7 rounded-full grid place-items-center text-[.65rem] font-extrabold text-accent-ink shrink-0"
                      style="background: radial-gradient(circle at 50% 34%, #66f0bf, var(--color-accent) 60%, #13a276)">
                  {(u.displayName || '?').charAt(0).toUpperCase()}
                </span>
                <div>
                  <div class="font-semibold text-[.95rem]">{u.displayName}</div>
                  <div class="text-muted text-sm">@{u.handle}</div>
                </div>
              </a>
            {/each}
          {/if}
        </div>
      {/if}
    </div>

    <!-- Feed items -->
    {#if loading}
      <p class="text-muted">Loading...</p>
    {:else if items.length === 0}
      <div class="banner banner-info">No activity yet. Search for players above and follow them to see their results here.</div>
    {:else}
      {#each items as item (item.game.id + item.user.id)}
        {@const even = item.net === 0}
        {@const won = item.net > 0}
        {@const verb = even ? 'broke even in' : (won ? 'won' : 'lost')}
        <a href="/game?g={item.game.id}" class="player-row no-underline text-text hover:border-border mb-2">
          <div class="flex items-start gap-3 min-w-0">
            <span class="w-8 h-8 rounded-full grid place-items-center text-[.7rem] font-extrabold text-accent-ink shrink-0 mt-0.5"
                  style="background: radial-gradient(circle at 50% 34%, #66f0bf, var(--color-accent) 60%, #13a276)">
              {(item.user.displayName || '?').charAt(0).toUpperCase()}
            </span>
            <div class="min-w-0">
              <div class="text-[.95rem] leading-snug">
                <span class="font-semibold text-info cursor-pointer hover:underline" onclick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/u/${item.user.handle}`; }}>{item.user.displayName}</span>
                {verb}
                {#if !even}<span class="font-extrabold tabular-nums {won ? 'text-accent' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(item.net, item.unit)}</span>{/if}
                {#if !even} in{/if} <span class="text-muted">{item.game.name}</span>
              </div>
              <div class="text-muted text-xs mt-0.5">{ago(item.at)}</div>
            </div>
          </div>
        </a>
      {/each}
    {/if}
  {/if}
</div>

<svelte:window onclick={(e) => { if (!(e.target as HTMLElement)?.closest('.relative')) searchOpen = false; }} />
