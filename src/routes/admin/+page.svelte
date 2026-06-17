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
          <div class="text-muted text-xs mt-1">games ({data.games.finished} finished)</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.engagement.avgGamesPerPlayer}</div>
          <div class="text-muted text-xs mt-1">avg games / player</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.games.avgPlayers}</div>
          <div class="text-muted text-xs mt-1">avg players / game</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold {data.engagement.avgNetPerPlayer >= 0 ? 'text-accent' : 'text-danger'}" style="font-family:var(--font-display)">{data.engagement.avgNetPerPlayer}</div>
          <div class="text-muted text-xs mt-1">avg net / player</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.engagement.playersWhoPlayed}</div>
          <div class="text-muted text-xs mt-1">players who played</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-2xl font-extrabold" style="font-family:var(--font-display)">{data.games.buyIns}</div>
          <div class="text-muted text-xs mt-1">buy-in events</div>
        </div>
        <div class="card text-center !mb-0">
          <div class="text-sm font-semibold mt-2 leading-tight">{providerLine(data.providers)}</div>
          <div class="text-muted text-xs mt-1">by provider</div>
        </div>
        {#if data.engagement.biggestNight}
          <div class="card text-center !mb-0">
            <div class="text-2xl font-extrabold text-accent" style="font-family:var(--font-display)">{data.engagement.biggestNight.net}</div>
            <div class="text-muted text-xs mt-1 truncate">biggest night · @{data.engagement.biggestNight.handle}</div>
          </div>
        {/if}
      </div>
      <p class="text-muted text-xs mb-5">Net figures combine all currencies — treat as a rough indicator if games use different units.</p>
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
