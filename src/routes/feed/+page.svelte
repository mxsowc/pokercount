<script lang="ts">
  import { page } from '$app/stores';
  import { fmtSigned } from '$lib/utils/money';
  import { ago } from '$lib/utils/time';
  import { onMount } from 'svelte';

  let user = $derived($page.data?.user ?? null);
  let items = $state<any[]>([]);
  let loading = $state(true);

  let tab = $state<'feed' | 'leaderboard'>('feed');
  let boardScope = $state<'following' | 'global' | 'city'>('following');
  let boards = $state<Record<string, any[]>>({}); // scope -> rows (cached per scope)
  let boardLoadingScope = $state<string | null>(null);
  let boardCity = $state<string | null>(null); // resolved city label for the city board
  const board = $derived(boards[boardScope] ?? []);
  const boardLoading = $derived(boardLoadingScope === boardScope && !boards[boardScope]);

  // Search
  let query = $state('');
  let searchResults = $state<any[]>([]);
  let searchOpen = $state(false);
  let searchTimer: ReturnType<typeof setTimeout>;

  const REACTIONS = ['👏', '🖕'];
  const initial = (n: string) => (n || '?').charAt(0).toUpperCase();

  // Collapse the flat feed into one card per game: if several people you follow
  // played the same night, they share a single grouped card instead of stacking N
  // near-identical rows. Newest game first; players within a game ordered by result.
  const groups = $derived.by(() => {
    const map = new Map<string, { game: any; unit: string; at: string; players: any[] }>();
    for (const it of items) {
      const g = map.get(it.game.id);
      if (g) { g.players.push(it); if (it.at > g.at) g.at = it.at; }
      else map.set(it.game.id, { game: it.game, unit: it.unit, at: it.at, players: [it] });
    }
    const arr = [...map.values()];
    for (const g of arr) g.players.sort((a, b) => (b.net ?? 0) - (a.net ?? 0));
    arr.sort((a, b) => (a.at < b.at ? 1 : -1));
    return arr;
  });

  onMount(async () => {
    if (!user) { loading = false; return; }
    try {
      const data = await (await fetch('/api/feed')).json();
      items = data.items || [];
    } catch {}
    loading = false;
  });

  async function loadBoard(scope: 'following' | 'global' | 'city') {
    if (boards[scope] || boardLoadingScope === scope) return; // cached or in flight
    boardLoadingScope = scope;
    try {
      const data = await (await fetch(`/api/leaderboard?scope=${scope}`)).json();
      boards = { ...boards, [scope]: data.rows || [] }; // only cache on success → a failed fetch retries
      if (scope === 'city') boardCity = data.city || null;
    } catch {}
    if (boardLoadingScope === scope) boardLoadingScope = null;
  }
  function showLeaderboard() { tab = 'leaderboard'; loadBoard(boardScope); }
  function setScope(s: 'following' | 'global' | 'city') { boardScope = s; loadBoard(s); }

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
        style="background: radial-gradient(circle at 50% 34%, #9c88c4, var(--color-accent) 60%, #493970)">{initial(name)}</span>
{/snippet}

<!-- Reactions + comments for one result — shared by the single and grouped cards. -->
{#snippet engagement(item: any)}
  {@const key = item.game.id + item.playerId}
  <div class="flex flex-wrap gap-1 mt-2">
    {#each REACTIONS as emoji}
      {@const n = item.reactions?.counts?.[emoji] || 0}
      {@const mine = item.reactions?.mine === emoji}
      <button type="button" onclick={(e) => react(item, emoji, e)}
        class="text-sm leading-none px-2.5 py-1 rounded-full border transition-colors {mine ? 'bg-accent/20 border-accent' : 'bg-surface border-transparent hover:border-border'}">
        {emoji}{#if n}<span class="ml-1 text-xs tabular-nums {mine ? 'text-text' : 'text-muted'}">{n}</span>{/if}
      </button>
    {/each}
  </div>
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
{/snippet}

<!-- One followed player's result line (name + won/lost amount). -->
{#snippet resultText(item: any)}
  {@const even = item.net === 0}
  {@const won = item.net > 0}
  <span role="link" tabindex="0" class="font-semibold text-info cursor-pointer hover:underline"
    onclick={(e) => { e.preventDefault(); e.stopPropagation(); window.location.href = `/u/${item.user.handle}`; }}
    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); window.location.href = `/u/${item.user.handle}`; } }}>{item.user.displayName}</span>
  {even ? 'broke even' : (won ? 'won' : 'lost')}
  {#if !even}<span class="font-extrabold tabular-nums {won ? 'text-win' : 'text-danger'} font-display">{fmtSigned(item.net, item.unit)}</span>{/if}
{/snippet}

<div class="wrap">
  <h1 class="text-2xl font-bold mb-4">Feed</h1>

  {#if !user}
    <div class="banner banner-info">Sign in to see your feed. <a href="/account">Sign in</a></div>
  {:else}
    <!-- Tabs -->
    <div class="grid grid-cols-2 gap-1 bg-surface-2 border border-border rounded-xl p-1 mb-4">
      <button class="py-2 rounded-lg font-semibold text-sm transition-all {tab === 'feed' ? 'bg-gradient-to-b from-accent to-[#4e3c7c] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={() => (tab = 'feed')}>Feed</button>
      <button class="py-2 rounded-lg font-semibold text-sm transition-all {tab === 'leaderboard' ? 'bg-gradient-to-b from-accent to-[#4e3c7c] text-accent-ink shadow-md' : 'text-muted hover:text-text'}"
        onclick={showLeaderboard}>Leaderboard</button>
    </div>

    {#if tab === 'feed'}
      <!-- Search: searches EVERYONE on potcount, not just who you follow -->
      <div class="relative mb-4">
        <input class="input" type="search" bind:value={query} oninput={onSearch} placeholder="Search everyone on potcount by name…"
          autocapitalize="none" autocomplete="off" aria-label="Search all players on potcount"
          onkeydown={(e) => { if (e.key === 'Escape') { searchOpen = false; e.currentTarget.blur(); } }} />
        {#if !searchOpen}
          <p class="text-faint text-xs mt-1.5 px-1">Find and follow anyone — not just people you already follow.</p>
        {/if}
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
        <div class="flex flex-col gap-3">
          {#each Array(3) as _, i (i)}<div class="skeleton h-[104px]"></div>{/each}
        </div>
      {:else if items.length === 0}
        <div class="card text-center py-9">
          <div class="text-3xl mb-2" aria-hidden="true">🃏</div>
          <p class="font-semibold text-lg mb-1">Your feed is quiet</p>
          <p class="text-muted text-sm mb-5 max-w-[40ch] mx-auto">Play a game and everyone's results land here — who won, who lost, plus reactions and comments. Following your tablemates fills it faster.</p>
          <a href="/" class="btn inline-block no-underline">Open a game</a>
          <p class="text-xs text-faint mt-4">Or use search above to follow players. Set your profile <a href="/account">private</a> any time.</p>
        </div>
      {:else}
        {#each groups as grp (grp.game.id)}
          {#if grp.players.length === 1}
            {@const item = grp.players[0]}
            <div class="bg-surface-2 border border-border rounded-xl p-3 mb-2">
              <a href="/game?g={item.game.id}" class="flex items-start gap-3 min-w-0 no-underline text-text">
                {@render avatar(item.user.displayName, 'w-8 h-8 text-[.7rem] mt-0.5')}
                <div class="min-w-0 flex-1">
                  <div class="text-[.95rem] leading-snug">
                    {@render resultText(item)}
                    {#if item.net !== 0}in{:else}in{/if}
                    <span class="text-muted">{item.game.name}</span>
                  </div>
                  <div class="text-muted text-xs mt-0.5">{ago(item.at)}</div>
                </div>
              </a>
              {@render engagement(item)}
            </div>
          {:else}
            <!-- Grouped: several people you follow played the same game -->
            <div class="bg-surface-2 border border-border rounded-xl p-3 mb-2">
              <a href="/game?g={grp.game.id}" class="flex items-center justify-between gap-3 no-underline text-text pb-2.5 mb-1 border-b border-border-soft">
                <div class="min-w-0">
                  <div class="font-semibold text-[.95rem] truncate">{grp.game.name}</div>
                  <div class="text-muted text-xs mt-0.5">{grp.players.length} players you follow · {ago(grp.at)}</div>
                </div>
                <span class="text-faint text-lg leading-none shrink-0">›</span>
              </a>
              {#each grp.players as item, i (item.playerId)}
                <div class="py-2.5 {i > 0 ? 'border-t border-border-soft' : ''}">
                  <div class="flex items-center gap-2.5">
                    {@render avatar(item.user.displayName, 'w-7 h-7 text-[.65rem]')}
                    <div class="min-w-0 flex-1 text-[.92rem] leading-snug">{@render resultText(item)}</div>
                  </div>
                  {@render engagement(item)}
                </div>
              {/each}
            </div>
          {/if}
        {/each}
      {/if}

    {:else}
      <!-- Leaderboard scope -->
      <div class="seg grid-cols-3 mb-3 max-w-sm">
        <button class="seg-item {boardScope === 'following' ? 'is-active' : ''}" onclick={() => setScope('following')}>Following</button>
        <button class="seg-item {boardScope === 'city' ? 'is-active' : ''}" onclick={() => setScope('city')}>My city</button>
        <button class="seg-item {boardScope === 'global' ? 'is-active' : ''}" onclick={() => setScope('global')}>Everyone</button>
      </div>
      <p class="text-muted text-xs mb-3">{boardScope === 'global' ? 'Everyone on potcount with a public profile · all time' : boardScope === 'city' ? `Players in ${boardCity || user?.city || 'your city'} · all time` : 'You and the players you follow · all time'}</p>
      {#if boardLoading}
        <div class="flex flex-col gap-2">
          {#each Array(6) as _, i (i)}<div class="skeleton h-[62px]"></div>{/each}
        </div>
      {:else if board.length === 0}
        <div class="card text-center py-9">
          {#if boardScope === 'city' && !user?.city}
            <div class="text-3xl mb-2" aria-hidden="true">📍</div>
            <p class="font-semibold text-lg mb-1">Where do you play?</p>
            <p class="text-muted text-sm mb-5 max-w-[42ch] mx-auto">Add your home city to see the local leaderboard and let nearby players find your games.</p>
            <a href="/account" class="btn inline-block no-underline">Set your city</a>
          {:else}
            <div class="text-3xl mb-2" aria-hidden="true">{boardScope === 'city' ? '📍' : '🏆'}</div>
            <p class="font-semibold text-lg mb-1">Nothing to rank yet</p>
            <p class="text-muted text-sm mb-5 max-w-[42ch] mx-auto">{boardScope === 'global' ? 'Ranks everyone with a public profile by all-time profit — it fills in as players finish games.' : boardScope === 'city' ? `No ranked players in ${boardCity || user?.city} yet — invite the locals to potcount.` : 'Ranks you and the players you follow by all-time profit. Play a few games and follow your crew.'}</p>
            <a href="/" class="btn inline-block no-underline">Open a game</a>
            <p class="text-xs text-faint mt-4">{boardScope === 'global' ? 'You appear here only if your profile is public.' : boardScope === 'city' ? 'You appear here if your profile is public and your city matches.' : 'Use the Feed search to follow players.'} Change visibility on your <a href="/account">account</a>.</p>
          {/if}
        </div>
      {:else}
        {#each board as row, i (row.user.id)}
          <a href="/u/{row.user.handle}" class="player-row no-underline text-text hover:border-border mb-2 {row.you ? '!border-accent' : ''}">
            <div class="flex items-center gap-3 min-w-0">
              <span class="w-6 text-center font-bold tabular-nums shrink-0 {i < 3 ? 'text-base' : 'text-muted'}">{i < 3 ? ['🥇', '🥈', '🥉'][i] : i + 1}</span>
              {@render avatar(row.user.displayName, 'w-8 h-8 text-[.7rem]')}
              <div class="min-w-0">
                <div class="font-semibold text-[.95rem] truncate">{row.user.displayName}{#if row.you}<span class="text-muted font-normal"> · you</span>{/if}</div>
                <div class="text-muted text-xs">{row.games} game{row.games === 1 ? '' : 's'} · {fmtSigned(row.avg)}/game</div>
              </div>
            </div>
            <div class="font-extrabold tabular-nums shrink-0 {row.net >= 0 ? 'text-win' : 'text-danger'} font-display">{fmtSigned(row.net)}</div>
          </a>
        {/each}
      {/if}
    {/if}
  {/if}
</div>

<svelte:window onclick={(e) => { if (!(e.target as HTMLElement)?.closest('.relative')) searchOpen = false; }} />
