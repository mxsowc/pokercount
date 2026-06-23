<script lang="ts">
  import { page } from '$app/stores';
  import { toast } from '$lib/stores/toast';
  import { money, fmtSigned } from '$lib/utils/money';
  import { onMount } from 'svelte';

  let handle = $derived($page.params.handle ?? '');
  let me = $derived($page.data?.user ?? null);

  let profileUser = $state<any>(null);
  let stats = $state<any>(null);
  let social = $state<{ followers: number; following: number; youFollow: boolean } | null>(null);
  let loading = $state(true);
  let error = $state('');

  // Social list overlay
  let socialList = $state<{ title: string; users: any[] } | null>(null);

  // Multi-select game stats
  let selectedGames = $state(new Set<string>());
  let selectMode = $state(false);
  const selectedStats = $derived.by(() => {
    if (!stats?.recent || selectedGames.size === 0) return null;
    const picked = stats.recent.filter((r: any) => selectedGames.has(r.id) && r.net != null);
    if (!picked.length) return null;
    const totalC = picked.reduce((s: number, r: any) => s + Math.round(r.net * 100), 0);
    const profitable = picked.filter((r: any) => r.net > 0).length;
    return {
      count: picked.length,
      total: Math.round(totalC) / 100,
      avg: Math.round(totalC / picked.length) / 100,
      profitablePct: Math.round((profitable / picked.length) * 100),
    };
  });
  function toggleGame(id: string) {
    const next = new Set(selectedGames);
    if (next.has(id)) next.delete(id); else next.add(id);
    selectedGames = next;
  }
  function clearSelection() { selectedGames = new Set(); selectMode = false; }

  onMount(async () => {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(handle)}/stats`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      profileUser = data.user;
      stats = data.stats;
    } catch (e: any) {
      error = e.message?.includes('no such') ? `No player @${handle}` : e.message;
      loading = false;
      return;
    }
    // Load social data
    if (me) {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(handle)}/social`);
        social = await res.json();
      } catch {}
    }
    loading = false;
  });

  async function toggleFollow() {
    if (!social || !profileUser) return;
    try {
      if (social.youFollow) {
        await fetch(`/api/users/${encodeURIComponent(handle)}/follow`, { method: 'DELETE' });
        social = { ...social, youFollow: false, followers: Math.max(0, social.followers - 1) };
      } else {
        await fetch(`/api/users/${encodeURIComponent(handle)}/follow`, { method: 'POST' });
        social = { ...social, youFollow: true, followers: social.followers + 1 };
      }
    } catch (e: any) { toast(e.message || 'Something went wrong'); }
  }

  async function showList(which: 'followers' | 'following') {
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(handle)}/${which}`);
      const data = await res.json();
      socialList = {
        title: which === 'followers' ? `Followers of ${profileUser.displayName}` : `${profileUser.displayName} follows`,
        users: data[which] || []
      };
    } catch {}
  }
</script>

<svelte:head><title>potcount — {handle}</title></svelte:head>

<div class="wrap">
  {#if loading}
    <p class="text-muted">Loading...</p>
  {:else if error}
    <div class="banner banner-warn">{error}</div>
    <p><a href="/">← Home</a></p>
  {:else if profileUser && stats}
    <!-- Profile card -->
    <div class="card">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-xl font-bold m-0">{profileUser.displayName}</h2>
          <div class="text-muted text-sm">@{profileUser.handle}</div>
        </div>
        {#if profileUser.avatar}
          <img src={profileUser.avatar} alt="" class="w-12 h-12 rounded-full" referrerpolicy="no-referrer" />
        {/if}
      </div>

      {#if social}
        <div class="flex items-center justify-between mt-3 pt-3 border-t border-border-soft">
          <div class="flex gap-4">
            <button class="text-left cursor-pointer bg-transparent border-0 p-0" onclick={() => showList('followers')}>
              <b class="tabular-nums">{social.followers}</b> <span class="text-muted text-sm">follower{social.followers !== 1 ? 's' : ''}</span>
            </button>
            <button class="text-left cursor-pointer bg-transparent border-0 p-0" onclick={() => showList('following')}>
              <b class="tabular-nums">{social.following}</b> <span class="text-muted text-sm">following</span>
            </button>
          </div>
          {#if me && me.handle !== profileUser.handle}
            <button class="btn-small {social.youFollow ? 'btn-ghost' : 'btn'}" onclick={toggleFollow}>
              {social.youFollow ? 'Unfollow' : 'Follow'}
            </button>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Stats grid -->
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-6 mb-3">Stats</h2>
    <div class="grid grid-cols-3 gap-2.5 max-[380px]:grid-cols-2">
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums {stats.totalProfit >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(stats.totalProfit)}</div>
        <div class="text-muted text-xs mt-1">total profit</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums" style="font-family:var(--font-display)">{stats.gamesPlayed ? fmtSigned(stats.avgProfit) : '—'}</div>
        <div class="text-muted text-xs mt-1">avg / game</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums" style="font-family:var(--font-display)">{stats.gamesPlayed ? stats.profitablePct + '%' : '—'}</div>
        <div class="text-muted text-xs mt-1">% profitable</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums" style="font-family:var(--font-display)">{stats.best ? fmtSigned(stats.best.net) : '—'}</div>
        <div class="text-muted text-xs mt-1">best night</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums" style="font-family:var(--font-display)">{stats.worst ? fmtSigned(stats.worst.net) : '—'}</div>
        <div class="text-muted text-xs mt-1">worst night</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums" style="font-family:var(--font-display)">{stats.gamesPlayed}</div>
        <div class="text-muted text-xs mt-1">games played</div>
      </div>
    </div>

    <!-- Recent games with multi-select -->
    {#if stats.recent?.length}
      <div class="flex items-center justify-between mt-6 mb-3">
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Recent games</h2>
        {#if selectMode}
          <div class="flex items-center gap-2">
            <span class="text-xs text-muted">{selectedGames.size} selected</span>
            <button class="btn-small btn-ghost !py-1.5 !px-2.5" onclick={clearSelection}>Done</button>
          </div>
        {:else}
          <button class="btn-small btn-ghost !py-1.5 !px-2.5" onclick={() => selectMode = true}>Compare</button>
        {/if}
      </div>

      {#if selectedStats}
        <div class="card !border-accent/40 mb-3">
          <div class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">Selected {selectedStats.count} games</div>
          <div class="grid grid-cols-3 gap-2">
            <div class="text-center">
              <div class="text-lg font-extrabold tabular-nums {selectedStats.total >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{selectedStats.total >= 0 ? '+' : ''}{fmtSigned(selectedStats.total)}</div>
              <div class="text-muted text-[.65rem]">total</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-extrabold tabular-nums {selectedStats.avg >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(selectedStats.avg)}</div>
              <div class="text-muted text-[.65rem]">avg / game</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-extrabold tabular-nums" style="font-family:var(--font-display)">{selectedStats.profitablePct}%</div>
              <div class="text-muted text-[.65rem]">profitable</div>
            </div>
          </div>
        </div>
      {/if}

      {#each stats.recent as r (r.id)}
        {#if selectMode}
          <button class="transfer-row w-full text-left {selectedGames.has(r.id) ? '!border-accent' : ''}" onclick={() => toggleGame(r.id)}>
            <span class="w-5 h-5 rounded border shrink-0 grid place-items-center {selectedGames.has(r.id) ? 'bg-accent border-accent text-accent-ink' : 'border-border'}">
              {#if selectedGames.has(r.id)}<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
            </span>
            <span class="font-semibold truncate">{r.name}</span>
            <span class="text-muted text-sm shrink-0">#{r.id}</span>
            {#if r.net != null}
              <span class="ml-auto font-bold tabular-nums shrink-0 {r.net >= 0 ? 'text-win' : 'text-danger'}">{fmtSigned(r.net)}</span>
            {:else}
              <span class="pill ml-auto shrink-0">in progress</span>
            {/if}
          </button>
        {:else}
          <a href="/game?g={r.id}" class="transfer-row no-underline text-text hover:border-border">
            <span class="font-semibold truncate">{r.name}</span>
            <span class="text-muted text-sm shrink-0">#{r.id}</span>
            {#if r.net != null}
              <span class="ml-auto font-bold tabular-nums shrink-0 {r.net >= 0 ? 'text-win' : 'text-danger'}">{fmtSigned(r.net)}</span>
            {:else}
              <span class="pill ml-auto shrink-0">in progress</span>
            {/if}
          </a>
        {/if}
      {/each}
    {/if}
  {/if}
</div>

<!-- Social list overlay -->
{#if socialList}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end justify-center"
       onclick={(e) => { if (e.target === e.currentTarget) socialList = null }}>
    <div class="w-full max-w-[640px] max-h-[70vh] overflow-y-auto bg-surface border border-border-soft rounded-t-2xl p-4 pb-[calc(16px+env(safe-area-inset-bottom,0px))]"
         style="animation: sheetup .2s var(--ease-spring) both" onclick={(e) => e.stopPropagation()}>
      <div class="flex items-center justify-between mb-3">
        <h3 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">{socialList.title}</h3>
        <button class="btn-small btn-ghost" onclick={() => socialList = null}>✕</button>
      </div>
      {#if socialList.users.length === 0}
        <p class="text-muted text-sm">None yet.</p>
      {:else}
        {#each socialList.users as u (u.id)}
          <a href="/u/{u.handle}" class="flex items-center gap-2.5 p-2.5 no-underline text-text hover:bg-surface-2 rounded-lg transition-colors">
            <span class="w-7 h-7 rounded-full grid place-items-center text-[.65rem] font-extrabold text-accent-ink shrink-0"
                  style="background: radial-gradient(circle at 50% 34%, #f0a47a, var(--color-accent) 60%, #a85a3a)">
              {(u.displayName || '?').charAt(0).toUpperCase()}
            </span>
            <div>
              <div class="font-semibold">{u.displayName}</div>
              <div class="text-muted text-sm">@{u.handle}</div>
            </div>
          </a>
        {/each}
      {/if}
    </div>
  </div>
{/if}
