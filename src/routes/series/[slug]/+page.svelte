<script lang="ts">
  import { page } from '$app/stores';
  import { fmtSigned } from '$lib/utils/money';
  import { toast } from '$lib/stores/toast';

  let { data } = $props();
  const s = $derived(data.stats);
  let user = $derived($page.data?.user ?? null);

  let nextDate = $state(data.stats.nextDate || '');
  let savingDate = $state(false);

  const medal = (i: number) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}`);
  function fmtDate(iso: string) {
    try { return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }); }
    catch { return ''; }
  }

  async function saveNextDate() {
    savingDate = true;
    try {
      const res = await fetch('/api/series', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: s.series, nextDate: nextDate || null }),
      });
      toast(res.ok ? (nextDate ? 'Next session saved' : 'Next session cleared') : 'Could not save');
    } catch { toast('Could not save'); }
    finally { savingDate = false; }
  }

  function shareStandings() {
    const url = `${location.origin}/series/${encodeURIComponent(s.series)}`;
    let text = `${s.series} — standings after ${s.gameCount} games\n\n`;
    s.leaderboard.slice(0, 8).forEach((e: any, i: number) => {
      text += `${medal(i)} ${e.name}: ${fmtSigned(e.totalNet, s.unit)} (${e.games}g · ${e.wins}w)\n`;
    });
    text += `\n${url}`;
    if (navigator.share) navigator.share({ title: 'potcount', text }).catch(() => {});
    else navigator.clipboard.writeText(text.trim()).then(() => toast('Standings copied')).catch(() => {});
  }
</script>

<svelte:head><meta name="robots" content="noindex" /></svelte:head>

<div class="wrap">
  <header class="mt-4 mb-5">
    <div class="text-accent uppercase tracking-[0.16em] text-xs font-bold mb-1">Season standings</div>
    <h1 class="text-3xl font-bold tracking-tight font-display">{s.series}</h1>
    <div class="flex items-center justify-between gap-3 mt-1.5">
      <p class="text-muted text-sm m-0">{s.gameCount} game{s.gameCount === 1 ? '' : 's'}{#if s.nextDate} · next {fmtDate(s.nextDate)}{/if}</p>
      <button class="btn-small btn-ghost !px-2.5" onclick={shareStandings}>Post to group</button>
    </div>
  </header>

  {#if user}
    <div class="card !bg-surface-2 mb-4">
      <label class="block text-xs text-muted font-medium mb-1" for="next-date">Next session</label>
      <div class="flex gap-2">
        <input id="next-date" class="input flex-1" type="date" bind:value={nextDate} />
        <button class="btn-small btn" disabled={savingDate} onclick={saveNextDate}>Save</button>
      </div>
      <p class="text-faint text-xs mt-1.5">Any member can set this — it shows on everyone's standings.</p>
    </div>
  {/if}

  <div class="card mb-4">
    <h2 class="sub-label m-0 mb-3">Leaderboard</h2>
    <div class="flex flex-col gap-2">
      {#each s.leaderboard as e, i (e.handle ?? e.name)}
        <div class="flex items-center justify-between gap-2">
          <span class="min-w-0 truncate">
            <span class="text-muted tabular-nums mr-1">{medal(i)}</span>
            {#if e.handle}<a href="/u/{e.handle}" class="font-semibold no-underline text-text hover:underline">{e.name}</a>{:else}<span class="font-semibold">{e.name}</span>{/if}
            <span class="text-muted text-xs ml-1">{e.games}g · {e.wins}w</span>
          </span>
          <span class="font-bold tabular-nums shrink-0 {e.totalNet >= 0 ? 'text-win' : 'text-danger'} font-display">{fmtSigned(e.totalNet, s.unit)}</span>
        </div>
      {/each}
    </div>
  </div>

  <div class="card">
    <h2 class="sub-label m-0 mb-3">Every night</h2>
    <div class="flex flex-col">
      {#each s.games as g (g.id)}
        <a href="/game?g={g.code}" class="flex items-center justify-between gap-2 py-2.5 px-2 -mx-2 rounded-lg no-underline text-text hover:bg-surface-2 border-b border-border-soft last:border-0">
          <span class="min-w-0 truncate text-sm">{fmtDate(g.createdAt)} · {g.players} players{#if g.winner} · <span class="text-muted">🥇 {g.winner}</span>{/if}</span>
          <span class="text-accent text-sm shrink-0">View →</span>
        </a>
      {/each}
    </div>
  </div>
</div>
