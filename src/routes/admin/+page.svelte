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
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-2">Users</h2>
    <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-5">
      <div class="card text-center !mb-0">
        <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.total}</div>
        <div class="text-muted text-xs mt-1">total users</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-2xl font-extrabold text-accent" style="font-family:var(--font-display)">{data.active30}</div>
        <div class="text-muted text-xs mt-1">active (30 days)</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.withEmail}</div>
        <div class="text-muted text-xs mt-1">with email</div>
      </div>
      <div class="card text-center !mb-0">
        <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.optedIn}</div>
        <div class="text-muted text-xs mt-1">newsletter opt-in</div>
      </div>
    </div>

    {#if data.games && data.engagement}
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-2">Games &amp; engagement</h2>
      <div class="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-2">
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.games.total}</div>
          <div class="text-muted text-xs mt-1">games played</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-xs font-semibold mt-2 leading-relaxed">
            {#if data.games.byStatus}
              {#each Object.entries(data.games.byStatus) as [status, count]}
                <span class="inline-block mr-1.5 {status === 'active' ? 'text-accent' : status === 'settled' ? 'text-gold' : 'text-muted'}">{count} {status}</span>
              {/each}
            {/if}
          </div>
          <div class="text-muted text-xs mt-1">by status</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.games.avgPlayers}</div>
          <div class="text-muted text-xs mt-1">avg players / game</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.games.totalDistinctPlayers || 0}</div>
          <div class="text-muted text-xs mt-1">distinct players (all)</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.engagement.playersWhoPlayed}</div>
          <div class="text-muted text-xs mt-1">linked accounts played</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.engagement.avgGamesPerPlayer}</div>
          <div class="text-muted text-xs mt-1">avg games / account</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.games.buyIns}</div>
          <div class="text-muted text-xs mt-1">buy-in events</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">€{data.games.avgBuyInPerPlayerEUR ?? 0}</div>
          {#if data.games.avgBuyInPerPlayerPts}<div class="text-sm font-bold text-muted tabular-nums">{data.games.avgBuyInPerPlayerPts} pts</div>{/if}
          {#each Object.entries(data.games.avgBuyInPerPlayerCrypto ?? {}) as [tk, v]}
            <div class="text-sm font-bold text-muted tabular-nums">{v} {tk}</div>
          {/each}
          <div class="text-muted text-xs mt-1">avg buy-in / person</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold {data.engagement.avgNetPerPlayerEUR >= 0 ? 'text-win' : 'text-danger'}" style="font-family:var(--font-display)">€{data.engagement.avgNetPerPlayerEUR}</div>
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
            <div class="text-2xl font-extrabold text-win" style="font-family:var(--font-display)">€{data.engagement.biggestNight.net}</div>
            <div class="text-muted text-xs mt-1 truncate">biggest night · @{data.engagement.biggestNight.handle}</div>
          </div>
        {/if}
      </div>
      <p class="text-muted text-xs mb-5">Stats count only actually-played games (2+ players with 2+ buy-ins); empty/test/one-buy-in games are excluded. Money figures: real currencies are converted to EUR (monthly FX rates); big blinds, chips and custom units are play money, counted 1:1 together as "pts"; crypto (BTC etc.) is shown per coin.</p>

      {#if data.games.recentGames?.length}
        <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-2">Recent games</h2>
        <div class="card !p-0 overflow-hidden mb-5">
          {#each data.games.recentGames as g (g.id)}
            <div class="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-border last:border-0">
              <!-- Tap the game to open its summary (works for ended/past games too) -->
              <a href="/game?g={g.id}" target="_blank" rel="noopener" class="min-w-0 no-underline text-text hover:opacity-80 transition-opacity" title="Open game #{g.code ?? g.id}">
                <div class="font-semibold text-sm truncate">
                  <span class="text-accent font-bold tracking-widest" style="font-family:var(--font-display)">#{g.code ?? g.id}</span>
                  {g.name || 'Untitled'} <span class="text-faint">↗</span>
                </div>
                <div class="text-muted text-xs truncate">{g.players} players · {g.transactions} buy-ins · pot {g.unit}{g.pot}</div>
              </a>
              <div class="flex items-center gap-2 shrink-0">
                <span class="pill {g.status === 'active' ? 'pill-win' : g.status === 'settled' ? 'pill-info' : ''}">{g.status}</span>
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
