<script lang="ts">
  import { page } from '$app/stores';
  import { toast } from '$lib/stores/toast';
  import { money, fmtSigned } from '$lib/utils/money';
  import { AWARDS } from '$lib/awards';
  import Sparkline from '$lib/components/Sparkline.svelte';

  let handle = $derived($page.params.handle ?? '');
  let me = $derived($page.data?.user ?? null);

  let profileUser = $state<any>(null);
  let stats = $state<any>(null);
  let badges = $state<any>(null);
  let social = $state<{ followers: number; following: number; youFollow: boolean } | null>(null);
  let hasSettlementSpeed = $state(false);
  let loading = $state(true);
  let error = $state('');
  let chartTab = $state<'profit' | 'level'>('profit');

  // Social list overlay
  let socialList = $state<{ title: string; users: any[] } | null>(null);

  // Multi-select game stats
  let selectedGames = $state(new Set<string>());
  let selectMode = $state(false);
  const selectedStats = $derived.by(() => {
    if (!stats?.recent || selectedGames.size === 0) return null;
    // Only games already in the display currency can be totalled (non-convertible
    // units like chips / big blinds / Bitcoin keep their own unit).
    const picked = stats.recent.filter((r: any) => selectedGames.has(r.id) && r.net != null && r.unit === stats.unit);
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

  // Load (re-load) whenever the profile handle changes. Using $effect rather than
  // onMount is essential: navigating profile→profile (social list, feed, player
  // links) REUSES this component, so onMount wouldn't re-run and every visitor
  // after the first would see the previous person's stats — and could follow the
  // wrong account. We reset state up front and ignore stale/out-of-order responses.
  $effect(() => {
    const h = handle;
    const signedIn = !!me; // read synchronously so the effect tracks it
    if (!h) return;
    loading = true; error = '';
    profileUser = null; stats = null; badges = null; social = null; socialList = null;
    selectedGames = new Set(); selectMode = false; chartTab = 'profit';
    let cancelled = false;
    const fresh = () => !cancelled && h === handle; // bail if we've navigated on
    (async () => {
      try {
        const res = await fetch(`/api/users/${encodeURIComponent(h)}/stats`);
        const data = await res.json();
        if (!fresh()) return;
        if (!res.ok) throw new Error(data.error);
        profileUser = data.user;
        stats = data.stats;
        badges = data.badges || null;
        hasSettlementSpeed = !!data.hasSettlementSpeed;
      } catch (e: any) {
        if (!fresh()) return;
        error = e.message?.includes('no such') ? `No player @${h}` : e.message;
        loading = false;
        return;
      }
      if (signedIn) {
        try {
          const res = await fetch(`/api/users/${encodeURIComponent(h)}/social`);
          const s = await res.json();
          if (fresh()) social = s;
        } catch {}
      }
      if (fresh()) loading = false;
    })();
    return () => { cancelled = true; };
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
    <div class="skeleton h-[92px] mb-3.5"></div>
    <div class="skeleton h-[168px] mt-6 mb-3"></div>
    <div class="grid grid-cols-3 gap-2.5 max-[380px]:grid-cols-2 mt-5">
      {#each Array(6) as _, i (i)}<div class="skeleton h-[68px]"></div>{/each}
    </div>
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
          {#if profileUser.city}
            <div class="text-muted text-sm flex items-center gap-1 mt-0.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" class="shrink-0 text-faint" aria-hidden="true"><path d="M12 21s7-5.686 7-11a7 7 0 10-14 0c0 5.314 7 11 7 11z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="10" r="2.5" stroke="currentColor" stroke-width="2"/></svg>
              {profileUser.city}
            </div>
          {/if}
          {#if stats?.level}
            {#if stats.level.reliability >= 40}
              <div class="text-sm font-semibold mt-1 {stats.level.level >= 6 ? 'text-gold' : stats.level.level >= 5 ? 'text-accent' : stats.level.level >= 4 ? 'text-info' : 'text-muted'}">
                Lv. {stats.level.level.toFixed(2)} · {stats.level.label} · {stats.level.reliability}%
              </div>
            {:else}
              <div class="text-sm text-faint mt-1">Not yet rated</div>
            {/if}
          {/if}
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

    <!-- Hero: the emotional headline — am I up or down, all-time? -->
    <div class="card mt-6 !p-5">
      <div class="text-xs uppercase tracking-widest text-muted font-semibold mb-1.5">All-time{#if stats.gamesPlayed} · {stats.unit}{/if}</div>
      {#if stats.gamesPlayed}
        <div class="text-[2.7rem] leading-none font-extrabold tabular-nums {stats.totalProfit >= 0 ? 'text-win' : 'text-danger'} font-display">{fmtSigned(stats.totalProfit, stats.unit)}</div>
        <div class="text-muted text-sm mt-2">across {stats.gamesPlayed} game{stats.gamesPlayed === 1 ? '' : 's'}{#if stats.streak && stats.streak.current > 0} · <span class="{stats.streak.kind === 'win' ? 'text-win' : 'text-danger'} font-semibold">{stats.streak.kind === 'win' ? '🔥' : '❄️'} {stats.streak.current}{stats.streak.kind === 'win' ? 'W' : 'L'}</span>{/if}</div>
        {#if stats.curve && stats.curve.length >= 2}
          <div class="mt-4">
            {#if stats.levelCurve?.length >= 2}
              <div class="flex gap-1 text-xs font-semibold mb-2">
                <button class="px-2 py-0.5 rounded-full transition-colors {chartTab === 'profit' ? 'bg-surface-3 text-text' : 'text-faint'}" onclick={() => chartTab = 'profit'}>Profit</button>
                <button class="px-2 py-0.5 rounded-full transition-colors {chartTab === 'level' ? 'bg-surface-3 text-text' : 'text-faint'}" onclick={() => chartTab = 'level'}>Level</button>
              </div>
            {/if}
            {#if chartTab === 'profit'}
              <Sparkline points={stats.curve.map((p: any) => p.cum)} />
            {:else}
              <Sparkline points={stats.levelCurve} baseline={false} color="var(--color-accent)" />
            {/if}
          </div>
        {/if}
      {:else}
        <div class="text-2xl font-extrabold text-muted font-display">—</div>
        <div class="text-muted text-sm mt-2">No finished games yet.</div>
      {/if}
    </div>
    {#if stats.otherGames > 0}
      <p class="text-xs text-faint mt-2 mb-1">{stats.otherGames} game{stats.otherGames === 1 ? '' : 's'} in chips / other units aren't included.</p>
    {/if}

    {#if stats.gamesPlayed}
    <!-- Two headline stats — the clearest read on a player: how often they play,
         and how much they win/lose a night. Everything else sits smaller below. -->
    <div class="grid grid-cols-2 gap-2.5 mt-4">
      <div class="card text-center !mb-0 !py-5">
        <div class="text-3xl font-extrabold tabular-nums font-display">{stats.gamesPlayed}</div>
        <div class="text-muted text-xs mt-1.5 uppercase tracking-wide">games played</div>
      </div>
      <div class="card text-center !mb-0 !py-5">
        <div class="text-3xl font-extrabold tabular-nums {stats.avgProfit >= 0 ? 'text-win' : 'text-danger'} font-display">{fmtSigned(stats.avgProfit, stats.unit)}</div>
        <div class="text-muted text-xs mt-1.5 uppercase tracking-wide">avg / game</div>
      </div>
    </div>
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mt-5 mb-3">Breakdown</h2>
    <div class="grid grid-cols-3 gap-2.5 max-[380px]:grid-cols-2">
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums font-display">{stats.gamesPlayed ? stats.profitablePct + '%' : '—'}</div>
        <div class="text-muted text-xs mt-1">% profitable</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums font-display">{stats.best ? fmtSigned(stats.best.net, stats.unit) : '—'}</div>
        <div class="text-muted text-xs mt-1">best night</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums font-display">{stats.worst ? fmtSigned(stats.worst.net, stats.unit) : '—'}</div>
        <div class="text-muted text-xs mt-1">worst night</div>
      </div>
      {#if stats.placement}
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums font-display {stats.placement.nightsWon > 0 ? 'text-win' : ''}">{stats.placement.nightsWon}<span class="text-sm text-muted">×</span></div>
          <div class="text-muted text-xs mt-1">finished as chip leader</div>
        </div>
      {/if}
      <div class="card text-center !mb-0">
        <div class="text-xl font-extrabold tabular-nums font-display">{stats.gamesPlayed ? money(stats.avgBuyIn, stats.unit) : '—'}</div>
        <div class="text-muted text-xs mt-1">avg buy-in</div>
      </div>
      {#if stats.hourly}
        <div class="card text-center !mb-0">
          <div class="text-xl font-extrabold tabular-nums {stats.hourly.rate >= 0 ? 'text-win' : 'text-danger'} font-display">{fmtSigned(stats.hourly.rate, stats.unit)}<span class="text-sm text-muted">/h</span></div>
          <div class="text-muted text-xs mt-1">per hour · {stats.hourly.games}g · {stats.hourly.hours}h</div>
        </div>
      {/if}
      {#if stats.settlementSpeed}
        <!-- Own/preview value is shown, but it's a Pro-only stat — tapping says so. -->
        <button class="card text-center !mb-0 relative overflow-hidden cursor-pointer" onclick={() => toast('Avg time to pay is a Pro-only stat — available to Pro members')}>
          <span class="absolute top-1.5 right-1.5 text-[9px] font-bold text-accent uppercase tracking-[0.15em] leading-none bg-accent/12 border border-accent/30 rounded-full px-1.5 py-0.5">Pro</span>
          <div class="text-xl font-extrabold tabular-nums font-display">{stats.settlementSpeed.avgDays}d</div>
          <div class="text-muted text-xs mt-1">avg settle time · {stats.settlementSpeed.count} transfers</div>
        </button>
      {:else if hasSettlementSpeed}
        <!-- Pro-gated: keep the label readable so the stat sells itself; blur only
             the value and tuck "Pro" into a corner badge (a full overlay hid what
             the stat even was). -->
        <button class="card text-center !mb-0 relative overflow-hidden cursor-pointer" onclick={() => toast('Settlement speed is a Pro feature — coming soon')}>
          <span class="absolute top-1.5 right-1.5 text-[9px] font-bold text-accent uppercase tracking-[0.15em] leading-none bg-accent/12 border border-accent/30 rounded-full px-1.5 py-0.5">Pro</span>
          <div class="text-xl font-extrabold tabular-nums font-display blur-[6px] select-none opacity-80" aria-hidden="true">1.2d</div>
          <div class="text-muted text-xs mt-1">avg settle time</div>
        </button>
      {/if}
    </div>
    {/if}

    <!-- Award badges (peer-voted, across all games) -->
    {#if badges && AWARDS.some((a) => badges[a.key] > 0)}
      <div class="flex flex-wrap gap-2 mt-4">
        {#each AWARDS as award (award.key)}
          {#if badges[award.key] > 0}
            <div class="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-surface-2 border border-border text-sm">
              <span>{award.emoji}</span>
              <span class="font-semibold">{award.label}</span>
              <span class="text-muted">× {badges[award.key]}</span>
            </div>
          {/if}
        {/each}
      </div>
    {/if}

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
          <div class="sub-label mb-2">Selected {selectedStats.count} games</div>
          <div class="grid grid-cols-3 gap-2">
            <div class="text-center">
              <div class="text-lg font-extrabold tabular-nums {selectedStats.total >= 0 ? 'text-win' : 'text-danger'} font-display">{fmtSigned(selectedStats.total, stats.unit)}</div>
              <div class="text-muted text-[.65rem]">total</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-extrabold tabular-nums {selectedStats.avg >= 0 ? 'text-win' : 'text-danger'} font-display">{fmtSigned(selectedStats.avg, stats.unit)}</div>
              <div class="text-muted text-[.65rem]">avg / game</div>
            </div>
            <div class="text-center">
              <div class="text-lg font-extrabold tabular-nums font-display">{selectedStats.profitablePct}%</div>
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
              <span class="ml-auto font-bold tabular-nums shrink-0 {r.net >= 0 ? 'text-win' : 'text-danger'}">{fmtSigned(r.net, r.unit)}</span>
            {:else}
              <span class="pill ml-auto shrink-0">in progress</span>
            {/if}
          </button>
        {:else}
          <a href="/game?g={r.id}" class="transfer-row no-underline text-text hover:border-border">
            <span class="font-semibold truncate">{r.name}</span>
            <span class="text-muted text-sm shrink-0">#{r.id}</span>
            {#if r.net != null}
              <span class="ml-auto font-bold tabular-nums shrink-0 {r.net >= 0 ? 'text-win' : 'text-danger'}">{fmtSigned(r.net, r.unit)}</span>
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
