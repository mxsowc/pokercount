<script lang="ts">
  import { page } from '$app/stores';
  import { toast } from '$lib/stores/toast';
  import { money, fmtSigned } from '$lib/utils/money';
  import { onMount } from 'svelte';

  let handle = $derived($page.params.handle);
  let me = $derived($page.data?.user ?? null);

  let profileUser = $state<any>(null);
  let stats = $state<any>(null);
  let social = $state<{ followers: number; following: number; youFollow: boolean } | null>(null);
  let loading = $state(true);
  let error = $state('');

  // Social list overlay
  let socialList = $state<{ title: string; users: any[] } | null>(null);

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

<svelte:head><title>pokercount — {handle}</title></svelte:head>

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
        <div class="text-xl font-extrabold tabular-nums {stats.totalProfit >= 0 ? 'text-accent' : 'text-danger'}" style="font-family:var(--font-display)">{fmtSigned(stats.totalProfit)}</div>
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

    <!-- Recent games -->
    {#if stats.recent?.length}
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-6 mb-3">Recent games</h2>
      {#each stats.recent as r (r.id)}
        <a href="/game?g={r.id}" class="transfer-row no-underline text-text hover:border-border">
          <span class="font-semibold">{r.name}</span>
          <span class="text-muted text-sm">#{r.id}</span>
          {#if r.net != null}
            <span class="ml-auto font-bold tabular-nums {r.net >= 0 ? 'text-accent' : 'text-danger'}">{fmtSigned(r.net)}</span>
          {:else}
            <span class="pill ml-auto">in progress</span>
          {/if}
        </a>
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
                  style="background: radial-gradient(circle at 50% 34%, #66f0bf, var(--color-accent) 60%, #13a276)">
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
