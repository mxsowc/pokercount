<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  let password = $state('');
  let data = $state<any>(null);
  let error = $state('');
  let loading = $state(false);

  async function load(pw: string) {
    loading = true; error = '';
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        error = d.error || 'Failed';
        data = null;
        if (browser) sessionStorage.removeItem('pc_admin_pw');
        return;
      }
      data = d;
      if (browser) sessionStorage.setItem('pc_admin_pw', pw); // survive reloads this tab only
    } catch (e: any) { error = e.message; }
    finally { loading = false; }
  }

  function unlock() { if (password) load(password); }
  function lock() { data = null; password = ''; if (browser) sessionStorage.removeItem('pc_admin_pw'); }

  // Operator-only hard delete of a game (e.g. test tables). Reuses the held admin
  // password; refreshes the panel after.
  let deletingId = $state<string | null>(null);
  async function deleteGameAdmin(g: any) {
    const label = `#${g.code ?? g.id}${g.name ? ` "${g.name}"` : ''}`;
    if (!confirm(`Delete game ${label} permanently? This removes it for everyone and cannot be undone.`)) return;
    deletingId = g.id;
    error = '';
    try {
      const res = await fetch('/api/admin/delete-game', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, id: g.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { error = d.error || 'Delete failed'; return; }
      await load(password); // refresh list + stats
    } catch (e: any) { error = e.message; }
    finally { deletingId = null; }
  }

  // Ban / un-ban an account from the reports queue. Reuses the held admin password.
  let banningId = $state<string | null>(null);
  async function setBan(userId: string, banned: boolean, reportId?: string, name?: string) {
    if (banned && !confirm(`Ban ${name || 'this account'}? They'll be signed out and can't sign back in.`)) return;
    banningId = userId;
    error = '';
    try {
      const res = await fetch('/api/admin/ban', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, userId, banned, reportId }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { error = d.error || 'Ban failed'; return; }
      await load(password);
    } catch (e: any) { error = e.message; }
    finally { banningId = null; }
  }

  onMount(() => {
    const saved = browser ? sessionStorage.getItem('pc_admin_pw') : null;
    if (saved) { password = saved; load(saved); }
  });

  const fmtDate = (s: string) => { try { return new Date(s).toLocaleString(); } catch { return s; } };
  const providerLine = (p: Record<string, number>) =>
    Object.entries(p).map(([k, v]) => `${v} ${k}`).join(' · ') || '—';
</script>

<svelte:head><title>potcount — admin</title><meta name="robots" content="noindex" /></svelte:head>

<div class="wrap">
  <div class="flex items-center justify-between mb-4">
    <h1 class="text-2xl font-bold">Admin</h1>
    {#if data}<button class="btn-small btn-secondary" onclick={lock}>Lock</button>{/if}
  </div>

  {#if !data}
    <div class="card max-w-sm">
      <label class="block text-xs text-muted font-medium mb-1">Admin password</label>
      <input class="input" type="password" bind:value={password} autocomplete="current-password"
        onkeydown={(e) => { if (e.key === 'Enter') unlock(); }} />
      <button class="btn w-full mt-3" onclick={unlock} disabled={loading}>{loading ? 'Checking…' : 'Unlock'}</button>
      {#if error}<p class="text-danger text-sm mt-2">{error}</p>{/if}
    </div>
  {:else}
    {#if data.reports?.length}
      <h2 class="text-sm font-semibold uppercase tracking-widest text-danger mb-2">⚠ Reports ({data.reports.length})</h2>
      <div class="grid gap-2.5 mb-6">
        {#each data.reports as r (r.id)}
          <div class="card !mb-0 !border-danger/30">
            <div class="flex items-center justify-between gap-2 flex-wrap">
              <div class="text-sm">
                {#if r.reporter.handle}<a href="/u/{r.reporter.handle}" target="_blank" rel="noopener" class="text-text font-semibold hover:text-accent">@{r.reporter.handle}</a>{:else}<span class="text-muted">{r.reporter.displayName}</span>{/if}
                <span class="text-muted">reported</span>
                {#if r.reported.handle}<a href="/u/{r.reported.handle}" target="_blank" rel="noopener" class="font-semibold {r.reported.banned ? 'text-danger line-through' : 'text-text hover:text-accent'}">@{r.reported.handle}</a>{:else}<span class="text-muted">{r.reported.displayName}</span>{/if}
                {#if r.reported.banned}<span class="pill !border-danger/50 text-danger ml-1">banned</span>{/if}
              </div>
              <span class="text-xs text-faint tabular-nums shrink-0">{fmtDate(r.at)}</span>
            </div>
            <div class="mt-1.5"><span class="pill !border-danger/40 text-danger">{r.reasonLabel}</span></div>
            {#if r.message}<p class="text-muted text-sm mt-2 whitespace-pre-wrap">“{r.message}”</p>{/if}
            <div class="flex items-center gap-3 mt-3 flex-wrap">
              {#if r.sharedGame}
                <a href="/game?g={r.sharedGame.id}" target="_blank" rel="noopener" class="text-xs text-accent hover:underline">Shared game: #{r.sharedGame.code} {r.sharedGame.name}</a>
              {:else}
                <span class="text-xs text-faint">No shared game</span>
              {/if}
              {#if r.reported.handle}
                {#if r.reported.banned}
                  <button class="btn-small btn-ghost ml-auto" disabled={banningId === r.reported.id} onclick={() => setBan(r.reported.id, false)}>{banningId === r.reported.id ? '…' : 'Un-ban'}</button>
                {:else}
                  <button class="btn-small btn-danger ml-auto" disabled={banningId === r.reported.id} onclick={() => setBan(r.reported.id, true, r.id, '@' + r.reported.handle)}>{banningId === r.reported.id ? '…' : 'Ban account'}</button>
                {/if}
              {/if}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-2">Users</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
      <div class="card text-center !mb-0">
        <div class="text-2xl font-extrabold font-display">{data.total}</div>
        <div class="text-muted text-xs mt-1">total users</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-2xl font-extrabold text-accent font-display">{data.active30}</div>
        <div class="text-muted text-xs mt-1">active (30 days)</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-2xl font-extrabold font-display">{data.withEmail}</div>
        <div class="text-muted text-xs mt-1">with email</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-2xl font-extrabold font-display">{data.optedIn}</div>
        <div class="text-muted text-xs mt-1">newsletter opt-in</div>
      </div>
    </div>

    {#if data.games && data.engagement}
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-2">Games &amp; engagement</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2">
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold font-display">{data.games.total}</div>
          <div class="text-muted text-xs mt-1">games played</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xs font-semibold mt-2 leading-relaxed">
            {#if data.games.byStatus}
              {@const bs = data.games.byStatus}
              {@const finished = (bs.ended || 0) + (bs.settled || 0)}
              {#if bs.active}<span class="inline-block mr-1.5 text-accent">{bs.active} active</span>{/if}
              {#if bs.scheduled}<span class="inline-block mr-1.5 text-muted">{bs.scheduled} scheduled</span>{/if}
              {#if finished}<span class="inline-block mr-1.5 text-muted">{finished} finished</span>{/if}
            {/if}
          </div>
          <div class="text-muted text-xs mt-1">by status</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold font-display">{data.games.avgPlayers}</div>
          <div class="text-muted text-xs mt-1">avg players / game</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold font-display">{data.games.totalDistinctPlayers || 0}</div>
          <div class="text-muted text-xs mt-1">distinct players (all)</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold font-display">{data.engagement.playersWhoPlayed}</div>
          <div class="text-muted text-xs mt-1">linked accounts played</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold font-display">{data.engagement.avgGamesPerPlayer}</div>
          <div class="text-muted text-xs mt-1">avg games / account</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold font-display">{data.games.buyIns}</div>
          <div class="text-muted text-xs mt-1">buy-in events</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold font-display">€{data.games.avgBuyInPerPlayerEUR ?? 0}</div>
          {#if data.games.avgBuyInPerPlayerPts}<div class="text-sm font-bold text-muted tabular-nums">{data.games.avgBuyInPerPlayerPts} pts</div>{/if}
          {#each Object.entries(data.games.avgBuyInPerPlayerCrypto ?? {}) as [tk, v]}
            <div class="text-sm font-bold text-muted tabular-nums">{v} {tk}</div>
          {/each}
          <div class="text-muted text-xs mt-1">avg buy-in / person</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold font-display">€{data.games.avgPotPerGameEUR ?? 0}</div>
          {#if data.games.avgPotPerGamePts}<div class="text-sm font-bold text-muted tabular-nums">{data.games.avgPotPerGamePts} pts</div>{/if}
          {#each Object.entries(data.games.avgPotPerGameCrypto ?? {}) as [tk, v]}
            <div class="text-sm font-bold text-muted tabular-nums">{v} {tk}</div>
          {/each}
          <div class="text-muted text-xs mt-1">avg pot / game</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold {data.engagement.avgNetPerPlayerEUR >= 0 ? 'text-win' : 'text-danger'} font-display">€{data.engagement.avgNetPerPlayerEUR}</div>
          {#if data.engagement.avgNetPerPlayerPts}<div class="text-sm font-bold tabular-nums {data.engagement.avgNetPerPlayerPts >= 0 ? 'text-win' : 'text-danger'}">{data.engagement.avgNetPerPlayerPts} pts</div>{/if}
          {#each Object.entries(data.engagement.avgNetPerPlayerCrypto ?? {}) as [tk, v]}
            <div class="text-sm font-bold tabular-nums {(v as number) >= 0 ? 'text-win' : 'text-danger'}">{v} {tk}</div>
          {/each}
          <div class="text-muted text-xs mt-1">avg net / player</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-sm font-semibold mt-2 leading-tight">{providerLine(data.providers)}</div>
          <div class="text-muted text-xs mt-1">by provider</div>
        </div>
        {#if data.engagement.biggestNight}
          <div class="card text-center !mb-0">
            <div class="text-2xl font-extrabold text-win font-display">€{data.engagement.biggestNight.net}</div>
            <div class="text-muted text-xs mt-1 truncate">biggest night · @{data.engagement.biggestNight.handle}</div>
          </div>
        {/if}
      </div>
      <p class="text-muted text-xs mb-5">Stats count only actually-played games (2+ players with 2+ buy-ins); empty/test/one-buy-in games are excluded. Money figures: real currencies are converted to EUR (monthly FX rates); big blinds, chips and custom units are play money, counted 1:1 together as "pts"; crypto (BTC etc.) is shown per coin.</p>

      {#if data.openGames}
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-2">Open home games (blinds)</h2>
        <div class="card mb-5">
          <div class="grid grid-cols-3 gap-3 max-[420px]:grid-cols-2">
            <div><div class="text-xl font-extrabold tabular-nums font-display">{data.openGames.listedNow}</div><div class="text-muted text-xs mt-0.5">listed now</div></div>
            <div><div class="text-xl font-extrabold tabular-nums font-display">{data.openGames.listedEver}</div><div class="text-muted text-xs mt-0.5">listed ever</div></div>
            <div><div class="text-xl font-extrabold tabular-nums font-display">{data.openGames.seats}</div><div class="text-muted text-xs mt-0.5">seats</div></div>
            <div><div class="text-xl font-extrabold tabular-nums font-display">{data.openGames.blindsBoughtIn.toLocaleString()}</div><div class="text-muted text-xs mt-0.5">blinds bought in</div></div>
            <div><div class="text-xl font-extrabold tabular-nums font-display">{data.openGames.requests}</div><div class="text-muted text-xs mt-0.5">join requests</div></div>
            <div><div class="text-xl font-extrabold tabular-nums font-display">{data.openGames.approved}</div><div class="text-muted text-xs mt-0.5">approved</div></div>
          </div>
          {#if data.openGames.topCities?.length}
            <div class="mt-3 pt-3 border-t border-border-soft flex flex-wrap gap-1.5">
              {#each data.openGames.topCities as c (c.city)}
                <span class="pill">{c.city} · {c.count}</span>
              {/each}
            </div>
          {/if}
          <p class="text-faint text-xs mt-2">Public games listed on the /homegames city directory. Always played in blinds — this is social play, tracked separately from the money stats above.</p>
        </div>
      {/if}

      {#if data.games.acquisition}
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-2">Where games come from</h2>
        <div class="card mb-5">
          {#if data.games.acquisition.sources?.length}
            {@const tracked = data.games.acquisition.tracked}
            {#each data.games.acquisition.sources as s (s.source)}
              <div class="flex items-center justify-between gap-3 py-1.5 border-b border-border-soft last:border-0">
                <span class="text-sm font-medium truncate">{s.source}</span>
                <span class="flex items-center gap-2 shrink-0">
                  <span class="text-muted text-xs tabular-nums">{tracked ? Math.round((s.count / tracked) * 100) : 0}%</span>
                  <span class="font-bold tabular-nums">{s.count}</span>
                </span>
              </div>
            {/each}
            <p class="text-faint text-xs mt-2">{tracked} game{tracked === 1 ? '' : 's'} with a known source (first-party, cookieless). Older games created before tracking aren't counted. A leading <span class="font-mono">/path</span> means an SEO landing page; a host like <span class="font-mono">google.com</span> is an external referrer; <span class="font-mono">direct</span> = typed/bookmarked.</p>
          {:else}
            <p class="text-muted text-sm">No tracked sources yet — newly created games will show up here.</p>
          {/if}
        </div>
      {/if}

      {#if data.games.recentGames?.length}
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-2">Recent games</h2>
        <div class="card !p-0 overflow-hidden mb-5">
          {#each data.games.recentGames as g (g.id)}
            <div class="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-border last:border-0">
              <!-- Tap the game to open its summary (works for ended/past games too) -->
              <a href="/game?g={g.id}" target="_blank" rel="noopener" class="min-w-0 no-underline text-text hover:opacity-80 transition-opacity" title="Open game #{g.code ?? g.id}">
                <div class="font-semibold text-sm truncate">
                  <span class="text-accent font-bold tracking-widest font-display">#{g.code ?? g.id}</span>
                  {g.name || 'Untitled'} <span class="text-faint">↗</span>
                </div>
                <div class="text-muted text-xs truncate">{g.players} players · {g.transactions} buy-ins · pot {g.unit}{g.pot}</div>
              </a>
              <div class="flex items-center gap-2 shrink-0">
                <span class="pill {g.status === 'active' ? 'pill-win' : ''}">{g.status === 'active' ? 'active' : g.status === 'scheduled' ? 'scheduled' : 'finished'}</span>
                <span class="text-muted text-xs hidden sm:inline">{fmtDate(g.updatedAt)}</span>
                <button class="btn-small btn-danger !px-2.5" title="Delete this game permanently" disabled={deletingId === g.id} onclick={() => deleteGameAdmin(g)}>{deletingId === g.id ? '…' : '✕'}</button>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    {/if}

    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-2">Recent signups</h2>
    <div class="card !p-0 overflow-hidden">
      {#each data.recent as u (u.handle)}
        <div class="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-border last:border-0">
          <div class="min-w-0">
            <div class="font-semibold text-sm truncate">{u.displayName} <span class="text-muted font-normal">@{u.handle}</span></div>
            <div class="text-muted text-xs truncate">
              {u.provider}{u.email ? ' · ' + u.email : ''}{u.country ? ' · ' + u.country : ''}{u.ageRange ? ' · ' + u.ageRange : ''}{u.heardFrom ? ' · ' + u.heardFrom : ''}{u.newsletter ? ' · 📧 opted in' : ''}
            </div>
          </div>
          <div class="text-muted text-xs shrink-0 text-right">{fmtDate(u.createdAt)}</div>
        </div>
      {/each}
    </div>
  {/if}
</div>
