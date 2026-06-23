<script lang="ts">
  import { page } from '$app/stores';
  import { fmtSigned } from '$lib/utils/money';
  import { ago } from '$lib/utils/time';
  import { onMount } from 'svelte';

  let user = $derived($page.data?.user ?? null);
  let items = $state<any[]>([]);
  let loading = $state(true);

  let tab = $state<'feed' | 'leaderboard'>('feed');
  let board = $state<any[]>([]);
  let boardLoaded = $state(false);
  let boardLoading = $state(false);

  // Search
  let query = $state('');
  let searchResults = $state<any[]>([]);
  let searchOpen = $state(false);
  let searchTimer: ReturnType<typeof setTimeout>;

  const REACTIONS = ['👏', '🖕'];
  const initial = (n: string) => (n || '?').charAt(0).toUpperCase();

  onMount(async () => {
    if (!user) { loading = false; return; }
    try {
      const data = await (await fetch('/api/feed')).json();
      items = data.items || [];
    } catch {}
    loading = false;
  });

  async function showLeaderboard() {
    tab = 'leaderboard';
    if (boardLoaded || boardLoading) return;
    boardLoading = true;
    try {
      const data = await (await fetch('/api/leaderboard')).json();
      board = data.rows || [];
      boardLoaded = true; // only mark loaded on success, so a failed fetch retries
    } catch {}
    boardLoading = false;
  }

  let commentDraft = $state<Record<string, string>>({});

  async function react(item: any, emoji: string, e: Event) {
    e.preventDefault(); e.stopPropagation();
    try {
      const res = await fetch(`/api/games/${item.game.id}/players/${item.playerId}/react`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ emoji }),
      });
      if (res.ok) { item.reactions = await res.json(); items = items; }
    } catch {}
  }

  async function postComment(item: any) {
    const key = item.game.id + item.playerId;
    const text = (commentDraft[key] || '').trim();
    if (!text) return;
    try {
      const res = await fetch(`/api/games/${item.game.id}/players/${item.playerId}/comment`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
      });
      if (res.ok) { item.comments = [...(item.comments || []), await res.json()]; commentDraft[key] = ''; items = items; }
    } catch {}
  }

  function onSearch() {
    clearTimeout(searchTimer);
    const q = query.trim();
    if (q.length < 1) { searchOpen = false; return; }
    searchTimer = setTimeout(async () => {
      try {
        const data = await (await fetch(`/api/users/search?q=${encodeURIComponent(q)}`)).json();
        searchResults = data.users || [];
        searchOpen = true;
      } catch { searchOpen = false; }
    }, 250);
  }
</script>

<svelte:head><title>potcount — feed</title></svelte:head>

{#snippet avatar(name: string, size: string)}
  <span class="{size} rounded-full grid place-items-center font-extrabold text-accent-ink shrink-0"
        style="background: radial-gradient(circle at 50% 34%, #f0a47a, var(--color-accent) 60%, #a85a3a)">{initial(name)}</span>
{/snippet}

<div class="wrap">
  <h1 class="text-2xl font-bold mb-4">Feed</h1>

  {#if !user}
    <div class="banner banner-info">Sign in to see your feed. <a href="/account">Sign in</a></div>
  {:else}
    <!-- Tabs -->
    <div class="grid grid-cols-2 gap-1 bg-surface-2 border border-border rounded-xl p-1 mb-4">
      <button class="py-2 rounded-lg font-semibold text-sm transition-all {tab === 'feed' ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => (tab = 'feed')}>Feed</button>
      <button class="py-2 rounded-lg font-semibold text-sm transition-all {tab === 'leaderboard' ? 'bg-gradient-to-b from-accent to-[#b5603f] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={showLeaderboard}>Leaderboard</button>
    </div>

    {#if tab === 'feed'}
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
                  {@render avatar(u.displayName, 'w-7 h-7 text-[.65rem]')}
                  <div><div class="font-semibold text-[.95rem]">{u.displayName}</div><div class="text-muted text-sm">@{u.handle}</div></div>
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
        <div class="banner banner-info">
          <p class="font-semibold mb-1">Your feed is empty</p>
          <p class="mb-2">Once you follow some players, this is where their poker nights show up — who won, who lost, and how much — plus 👏 / 🖕 reactions and comments you can leave on each result.</p>
          <p class="mb-2">Use the <b>search box above</b> to find players by name and follow them. Their finished games then appear here automatically.</p>
          <p class="text-sm opacity-80">Your own results work the same way, and you're in control: set your profile to <b>private</b> on your <a href="/account">account</a> page if you'd rather not share your games and stats.</p>
        </div>
      {:else}
        {#each items as item (item.game.id + item.user.id)}
          {@const even = item.net === 0}
          {@const won = item.net > 0}
          {@const key = item.game.id + item.playerId}
          <div class="bg-surface-2 border border-border rounded-xl p-3 mb-2">
            <a href="/game?g={item.game.id}" class="flex items-start gap-3 min-w-0 no-underline text-text">
              {@render avatar(item.user.displayName, 'w-8 h-8 text-[.7rem] mt-0.5')}
              <div class="min-w-0 flex-1">
                <div class="text-[.95rem] leading-snug">
                  <span role="link" tabindex="0" class="font-semibold text-info cursor-pointer hover:underline"
                    onclick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/u/${item.user.handle}`; }}
                    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); window.location.href = `/u/${item.user.handle}`; } }}>{item.user.displayName}</span>
                  {even ? 'broke even in' : (won ? 'won' : 'lost')}
                  {#if !even}<span class="font-extrabold tabular-nums {won ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(item.net, item.unit)}</span> in{/if}
                  <span class="text-muted">{item.game.name}</span>
                </div>
                <div class="text-muted text-xs mt-0.5">{ago(item.at)}</div>
              </div>
            </a>

            <!-- Reactions -->
            <div class="flex flex-wrap gap-1 mt-2">
              {#each REACTIONS as emoji}
                {@const n = item.reactions?.counts?.[emoji] || 0}
                {@const mine = item.reactions?.mine === emoji}
                <button type="button" onclick={(e) => react(item, emoji, e)}
                  class="text-sm leading-none px-2.5 py-1 rounded-full border transition-colors {mine ? 'bg-accent/20 border-accent' : 'bg-surface border-transparent hover:border-border'} {n === 0 ? 'opacity-60' : ''}">
                  {emoji}{#if n}<span class="ml-1 text-xs tabular-nums {mine ? 'text-text' : 'text-muted'}">{n}</span>{/if}
                </button>
              {/each}
            </div>

            <!-- Comments -->
            {#if item.comments?.length}
              <div class="mt-2 space-y-1">
                {#each item.comments as c (c.id)}
                  <div class="text-sm leading-snug">
                    <a href="/u/{c.user.handle}" class="font-semibold text-info no-underline hover:underline">{c.user.displayName}</a>
                    <span class="text-text">{c.text}</span>
                    <span class="text-muted text-xs ml-1">{ago(c.at)}</span>
                  </div>
                {/each}
              </div>
            {/if}
            <form class="flex gap-2 mt-2" onsubmit={(e) => { e.preventDefault(); postComment(item); }}>
              <input class="input !py-1.5 !px-3 text-sm flex-1" bind:value={commentDraft[key]} maxlength="280"
                placeholder="Add a comment..." aria-label="Add a comment" />
              <button type="submit" class="btn-small" disabled={!commentDraft[key]?.trim()}>Send</button>
            </form>
          </div>
        {/each}
      {/if}

    {:else}
      <!-- Leaderboard -->
      <p class="text-muted text-xs mb-3">You and the players you follow · all time</p>
      {#if boardLoading}
        <p class="text-muted">Loading...</p>
      {:else if board.length === 0}
        <div class="banner banner-info">
          <p class="font-semibold mb-1">Nothing to rank yet</p>
          <p class="mb-2">The leaderboard ranks <b>you and the players you follow</b> by all-time profit, with profit-per-game alongside. It fills in once you've played some games and followed a few people.</p>
          <p class="mb-2">Head to the <b>Feed</b> tab and use its search to find and follow players — they'll show up here as soon as they have finished games.</p>
          <p class="text-sm opacity-80">Don't want to appear on others' leaderboards? Set your profile to <b>private</b> on your <a href="/account">account</a> page.</p>
        </div>
      {:else}
        {#each board as row, i (row.user.id)}
          <a href="/u/{row.user.handle}" class="player-row no-underline text-text hover:border-border mb-2 {row.you ? '!border-accent' : ''}">
            <div class="flex items-center gap-3 min-w-0">
              <span class="w-6 text-center font-bold tabular-nums text-muted shrink-0">{i + 1}</span>
              {@render avatar(row.user.displayName, 'w-8 h-8 text-[.7rem]')}
              <div class="min-w-0">
                <div class="font-semibold text-[.95rem] truncate">{row.user.displayName}{#if row.you}<span class="text-muted font-normal"> · you</span>{/if}</div>
                <div class="text-muted text-xs">{row.games} game{row.games === 1 ? '' : 's'} · {fmtSigned(row.avg, '€')}/game</div>
              </div>
            </div>
            <div class="font-extrabold tabular-nums shrink-0 {row.net >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(row.net, '€')}</div>
          </a>
        {/each}
      {/if}
    {/if}
  {/if}
</div>

<svelte:window onclick={(e) => { if (!(e.target as HTMLElement)?.closest('.relative')) searchOpen = false; }} />
