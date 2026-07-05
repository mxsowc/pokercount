<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { toast } from '$lib/stores/toast';
  import { ago } from '$lib/utils/time';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import CurrencyPicker from '$lib/components/CurrencyPicker.svelte';
  import { currencyForCountry } from '$lib/utils/currencies';

  // Focus a field as soon as it mounts (e.g. the Join view's code input) so the
  // keypad pops without an extra tap. Used via use:autofocus.
  function autofocus(node: HTMLInputElement) {
    requestAnimationFrame(() => node.focus());
  }
  import { getAcq } from '$lib/utils/acq';

  type View = 'intro' | 'open' | 'join';
  let view = $state<View>('intro');
  let user = $derived($page.data?.user ?? null);

  // Device identity (localStorage-backed)
  function getActor() {
    if (!browser) return { id: '', name: '' };
    let id = localStorage.getItem('pc_actor_id');
    if (!id) { id = 'u_' + crypto.randomUUID().slice(0, 8); localStorage.setItem('pc_actor_id', id); }
    return { id, name: localStorage.getItem('pc_actor_name') || '' };
  }
  function setActorName(n: string) {
    if (browser) localStorage.setItem('pc_actor_name', n);
  }

  // Recent games
  function listMyGames(): any[] {
    if (!browser) return [];
    try { return JSON.parse(localStorage.getItem('pc_games') || '[]'); } catch { return []; }
  }
  function rememberGame(game: any) {
    if (!browser || !game?.id) return;
    const list = listMyGames().filter((g: any) => g.id !== game.id);
    // Store the internal id (for the link) AND the human code (for display).
    list.unshift({ id: game.id, code: game.code ?? game.id, name: game.name, unit: game.unit, you: getActor().name, players: game.players.length, status: game.status, at: Date.now() });
    if (list.length > 20) list.length = 20;
    localStorage.setItem('pc_games', JSON.stringify(list));
  }

  let games = $state(listMyGames());
  // Home "Your games" is a quick jump-back list, not full history: show active
  // games (any age) plus anything touched in the last 24h. Older finished games
  // still live on your profile — they're just kept out of the way here.
  const DAY_MS = 24 * 60 * 60 * 1000;
  const recentGames = $derived(games.filter((g: any) => {
    if (g.status === 'active') return true;
    const t = new Date(g.at).getTime();
    return !Number.isFinite(t) || Date.now() - t < DAY_MS; // keep if recent (or timestamp unknown)
  }));
  let actor = $state(getActor());
  let nudgeDismissed = $state(false); // reactive mirror of the pc_host_nudge_dismissed flag

  // For a signed-in user, fold in games their account is seated in (any device,
  // even ones never opened here) so ongoing sessions surface on login.
  async function loadAccountGames() {
    if (!browser || !user) return;
    try {
      const res = await fetch('/api/me/games');
      if (!res.ok) return;
      const { games: server } = await res.json();
      const byId = new Map<string, any>();
      for (const g of listMyGames()) byId.set(g.id, { ...g });
      for (const sg of server) {
        const prev = byId.get(sg.id) || {};
        byId.set(sg.id, {
          id: sg.id, code: sg.code ?? prev.code ?? sg.id, name: sg.name, unit: sg.unit,
          you: sg.seatName || prev.you,
          players: sg.players, status: sg.status,
          at: prev.at ?? sg.at,   // keep local recency if we have it
          linked: true,           // account-linked: removed by "leaving" the game, not a local ✕
        });
      }
      const rank = (s: string) => (s === 'active' ? 0 : s === 'ended' ? 1 : 2);
      games = [...byId.values()].sort(
        (a, b) => rank(a.status) - rank(b.status) || (new Date(b.at).getTime() || 0) - (new Date(a.at).getTime() || 0)
      );
    } catch {}
  }

  onMount(() => {
    unitInput = defaultUnit();
    nudgeDismissed = !!localStorage.getItem('pc_host_nudge_dismissed');
    loadAccountGames();
    // Deep link from a landing page (e.g. /poker-chip-tracker) → open the form straight away.
    if (browser && $page.url.searchParams.get('start') === 'open') showOpen();
  });

  // Open game form
  let openName = $state('');
  let openCode = $state('');
  let openSeats = $state(0);
  let openSeries = $state('');
  let openBuyIn = $state(''); // table's standard buy-in → seeds the quick-buy on the game page

  const TAGLINES = [
    'Who has the boat?',
    'Please no pocket jacks',
    'Feels like a set-over-set night',
    'Runner runner never comes',
    'Always a flush draw',
    'Aces get cracked tonight',
    'The river giveth',
    'Big slick energy',
    'Praying for a blank',
    'Two pair is never good enough',
    'Check-raise or cry',
    'Everyone limps in',
    'One more bullet',
    'Pot is already disgusting',
    'Pocket kings walk',
    'Bad beats only tonight',
    'Suited connectors or fold pre',
    'Ship it',
  ];
  function gameTitle(): string {
    const d = new Date();
    const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const tag = TAGLINES[Math.floor(Math.random() * TAGLINES.length)];
    return `${day} — ${tag}`;
  }
  let generatedTitle = $state('');

  // Currency: the game's unit. A signed-in host's saved country wins; otherwise
  // guess from the device locale (so a $/£/zł host isn't silently stamped with
  // euros); EUR as the final fallback. Still freely changeable in the picker.
  let unitInput = $state('€');
  function defaultUnit(): string {
    if (user?.homeUnit) return user.homeUnit;
    try {
      const region = new Intl.Locale(navigator.language).maximize().region;
      return currencyForCountry(region);
    } catch { return '€'; }
  }

  // Join game form
  let joinCode = $state('');
  let joinName = $state('');
  let busy = $state(false);

  async function openGame() {
    const you = openName.trim();
    if (!you) { toast('Enter your name'); return; }
    if (busy) return;
    busy = true;
    setActorName(you);
    const players = [{ name: you }];
    for (let i = 0; i < openSeats; i++) players.push({ name: `Player ${i + 2}` });
    const code = openCode.replace(/[^0-9]/g, '');
    const buyIn = Number(String(openBuyIn).replace(',', '.').trim());
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Actor-Id': getActor().id, 'X-Actor-Name': encodeURIComponent(you) },
        body: JSON.stringify({ name: generatedTitle, unit: unitInput.trim() || '€', players, code: code || undefined, defaultBuyIn: buyIn > 0 ? buyIn : undefined, source: getAcq() || undefined })
      });
      const game = await res.json();
      if (!res.ok) {
        if (res.status === 409 && code) {
          toast(`A game with code #${code} is already running — pick another code or leave it blank.`);
        } else {
          toast(game.error || 'Failed');
        }
        return;
      }
      localStorage.setItem('pc_me_' + game.id, game.players[0].id);
      if (game.hostToken) localStorage.setItem('pc_host_' + game.id, game.hostToken);
      // Tag with series if provided
      const seriesVal = openSeries.trim();
      if (seriesVal) {
        await fetch(`/api/games/${game.id}/meta`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', 'X-Host-Token': game.hostToken || '' },
          body: JSON.stringify({ series: seriesVal }),
        }).catch(() => {});
      }
      rememberGame(game);
      goto(`/game?g=${game.id}&new=1`);
    } catch (e: any) { toast('Could not reach the server — check your connection'); }
    finally { busy = false; }
  }

  async function joinGame() {
    const code = joinCode.replace(/[^0-9]/g, '');
    const you = joinName.trim();
    if (code.length < 3) { toast('Enter the game code'); return; }
    if (!you) { toast('Enter your name'); return; }
    if (busy) return;
    busy = true;
    setActorName(you);
    try {
      const res = await fetch(`/api/games/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Actor-Id': getActor().id, 'X-Actor-Name': encodeURIComponent(you) },
        body: JSON.stringify({ name: you })
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error?.includes('not found') ? `No game with code #${code}` : data.error || 'Failed'); return; }
      const gid = data.game?.id || code;
      localStorage.setItem('pc_me_' + gid, data.playerId);
      rememberGame(data.game);
      goto(`/game?g=${gid}`);
    } catch (e: any) { toast('Could not reach the server — check your connection'); }
    finally { busy = false; }
  }

  function forgetGame(id: string) {
    localStorage.setItem('pc_games', JSON.stringify(listMyGames().filter((g: any) => g.id !== id)));
    localStorage.removeItem('pc_me_' + id);
    localStorage.removeItem('pc_host_' + id);
    // Drop just this game from the in-memory list. Re-reading listMyGames() here
    // would wipe account-linked games (which live server-side, not in pc_games).
    games = games.filter((g: any) => g.id !== id);
  }

  function showOpen() {
    view = 'open';
    openName = getActor().name;
    generatedTitle = gameTitle();
  }
  function showJoin() {
    view = 'join';
    joinName = getActor().name;
  }
</script>

<svelte:head>
  <title>potcount — poker home game tracker & who-pays-who settlement</title>
  <link rel="canonical" href="https://potcount.com/" />
</svelte:head>

<div class="wrap">
  {#if view === 'intro'}
    <section class="min-h-[calc(80vh-60px)] flex flex-col items-center justify-center max-md:block max-md:min-h-0 max-md:pt-3.5">
      <h1 class="text-[clamp(2.8rem,11vw,4.2rem)] font-bold tracking-tight leading-tight mb-2 text-center max-md:text-left"
          style="font-family: var(--font-display); letter-spacing: -0.04em;">
        pot<span class="text-accent font-bold">count</span>
      </h1>
      <p class="text-accent uppercase tracking-[0.18em] text-xs font-bold mb-3 text-center max-md:text-left w-full">
        Poker home game tracker
      </p>
      <p class="text-muted text-[1.05rem] max-w-[48ch] text-center max-md:text-left mb-5 w-full">
        Everyone at the table adds and sees their own buy-ins — no more trusting one person's notebook. Join with one code; at the end it works out who pays who.
      </p>

      {#if recentGames.length > 0}
        <div class="w-full mb-5">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">Your games</h3>
          {#each recentGames as g (g.id)}
            <a href="/game?g={g.id}" class="player-row no-underline text-text hover:border-border active:scale-[.99] transition-transform">
              <div>
                <div class="font-semibold">{g.name || 'Home Game'} <span class="text-accent font-bold tracking-widest text-sm" style="font-family: var(--font-display)">#{g.code ?? g.id}</span></div>
                <div class="text-muted text-xs mt-0.5">{g.you ? `you: ${g.you} · ` : ''}{g.players} players · {ago(new Date(g.at).toISOString())}{g.status === 'settled' ? ' · settled' : g.status === 'ended' ? ' · ended' : ''}</div>
              </div>
              <div class="flex items-center gap-2">
                <span class="pill {g.status === 'ended' || g.status === 'settled' ? '' : 'pill-win'}">{g.status === 'ended' || g.status === 'settled' ? 'View →' : 'Continue →'}</span>
                {#if !g.linked}
                  <button class="btn-small btn-danger" onclick={(e) => { e.preventDefault(); if (confirm(`Remove "${g.name || 'Home Game'}" from your list?`)) forgetGame(g.id); }}>✕</button>
                {/if}
              </div>
            </a>
          {/each}
        </div>
      {/if}

      <!-- "Host your own" nudge — shown once after a player's first completed game -->
      {#if games.length > 0 && games.some((g: any) => g.status === 'ended' || g.status === 'settled') && !games.some((g: any) => g.isHost) && browser && !nudgeDismissed}
        <div class="card !bg-surface !border-accent/25 !p-3 w-full mb-3">
          <div class="flex items-center justify-between gap-2">
            <div>
              <div class="text-sm font-semibold">Now you know how it works 🎴</div>
              <p class="text-muted text-xs mt-0.5">Open a game for your own group — they just need the code to join.</p>
            </div>
            <button class="text-xs text-faint hover:text-text p-2 -m-1 shrink-0" onclick={() => { localStorage.setItem('pc_host_nudge_dismissed', '1'); nudgeDismissed = true; }}>✕</button>
          </div>
        </div>
      {/if}

      <div class="flex flex-col gap-2.5 w-full max-w-[400px] mx-auto mt-5">
        <button class="btn w-full py-[18px] text-[1.1rem]" onclick={showOpen}>Open a game</button>
        <button class="btn btn-secondary w-full py-[18px] text-[1.1rem]" onclick={showJoin}>Join a game</button>
      </div>

      {#if games.length === 0}
        <!-- How it works — new visitors only; supports the CTA, doesn't replace it -->
        <div class="w-full max-w-[620px] mx-auto mt-10">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted text-center mb-4">How it works</h3>
          <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1 max-md:gap-2.5">
            <div class="pc-step bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5" style="--d:0ms">
              <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">🎴</div>
              <div>
                <div class="font-semibold text-sm">Open a game</div>
                <div class="text-muted text-xs mt-1 leading-snug">Name it and get a 4-digit code.</div>
              </div>
            </div>
            <div class="pc-step bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5" style="--d:90ms">
              <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">💰</div>
              <div>
                <div class="font-semibold text-sm">Track the money</div>
                <div class="text-muted text-xs mt-1 leading-snug">Add buy-ins &amp; top-ups as you play — or share the code so players add their own.</div>
              </div>
            </div>
            <div class="pc-step bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5" style="--d:180ms">
              <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">🧮</div>
              <div>
                <div class="font-semibold text-sm">Settle up</div>
                <div class="text-muted text-xs mt-1 leading-snug">It works out who pays who in the fewest payments — and who had the best night.</div>
              </div>
            </div>
          </div>
          <p class="text-muted text-xs text-center mt-5 max-w-[48ch] mx-auto">
            Just splitting one pot right now? The <a href="/pot">Split tool</a> does it instantly — no game needed.
          </p>
          <p class="text-muted text-xs text-center mt-1.5 max-w-[48ch] mx-auto">
            New to this? See how the <a href="/poker-chip-tracker">poker chip tracker</a> works.
          </p>
        </div>
      {/if}

      <p class="text-muted text-xs text-center mt-5 max-w-[48ch] mx-auto">
        Games live on the server — anyone with the code can keep adding and settle later, even after the host closes the app.
      </p>
    </section>

  {:else if view === 'open'}
    <button class="btn-small btn-ghost mb-3" onclick={() => view = 'intro'}>← Back</button>
    <h1 class="text-2xl font-bold mb-1">Open a game</h1>
    <p class="text-muted mb-4">You'll get a code to share. Everyone else just joins with it.</p>
    <div class="card">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-muted text-sm flex-1 italic truncate">{generatedTitle}</span>
        <button type="button" class="btn-small btn-secondary !py-1.5 !px-2.5 shrink-0" onclick={() => generatedTitle = gameTitle()} title="Shuffle title">🔀</button>
      </div>
      <label class="block text-xs text-muted font-medium mb-1">Your name</label>
      <input class="input" bind:value={openName} placeholder="e.g. Max" maxlength="40" autocapitalize="words" autocomplete="name" enterkeyhint="done" />
      <details class="mt-3">
        <summary class="text-sm text-muted cursor-pointer">More options</summary>

        <!-- Currency: searchable + custom -->
        <label class="block text-xs text-muted font-medium mb-1 mt-3">Currency</label>
        <CurrencyPicker bind:value={unitInput} />
        <p class="text-muted text-xs mt-1">Pick one or type your own — it can even be “big blinds”, “chips”, anything.</p>

        <label class="block text-xs text-muted font-medium mb-1 mt-3">Series (optional)</label>
        <input class="input" bind:value={openSeries} placeholder="e.g. Thursday PLO" maxlength="60" />
        <p class="text-xs text-faint mt-1">Tag recurring games to track a running leaderboard across sessions.</p>

        <label class="block text-xs text-muted font-medium mb-1 mt-3">Standard buy-in (optional)</label>
        <input class="input" bind:value={openBuyIn} inputmode="decimal" placeholder="e.g. 20" />
        <p class="text-xs text-faint mt-1">Sets the default for the one-tap buy-in and "buy everyone in". You can still enter any amount.</p>

        <div class="flex gap-2.5 mt-3">
          <div class="flex-1">
            <label class="block text-xs text-muted font-medium mb-1">Custom code (optional)</label>
            <input class="input" bind:value={openCode} inputmode="numeric" placeholder="auto e.g. 2137" maxlength="6" />
          </div>
          <div class="flex-1">
            <label class="block text-xs text-muted font-medium mb-1">Extra empty seats</label>
            <input class="input" type="number" bind:value={openSeats} inputmode="numeric" min="0" max="20" />
          </div>
        </div>
      </details>
      <button class="btn w-full mt-4" disabled={busy} onclick={openGame}>{busy ? 'Opening...' : 'Open game'}</button>
    </div>

  {:else if view === 'join'}
    <button class="btn-small btn-ghost mb-3" onclick={() => view = 'intro'}>← Back</button>
    <h1 class="text-2xl font-bold mb-1">Join a game</h1>
    <p class="text-muted mb-4">Enter the code the host shared and your name.</p>
    <div class="card">
      <label class="block text-xs text-muted font-medium mb-1 mt-3">Game code</label>
      <input class="input tracking-widest text-xl" bind:value={joinCode} inputmode="numeric" enterkeyhint="next" placeholder="2137" maxlength="6"
             use:autofocus
             onkeydown={(e) => { if (e.key === 'Enter') joinGame(); }} />
      <label class="block text-xs text-muted font-medium mb-1 mt-3">Your name</label>
      <input class="input" bind:value={joinName} placeholder="e.g. Max" maxlength="40"
             autocapitalize="words" autocomplete="name" enterkeyhint="go"
             onkeydown={(e) => { if (e.key === 'Enter') joinGame(); }} />
      <button class="btn w-full mt-4" disabled={busy} onclick={joinGame}>{busy ? 'Joining...' : 'Join game'}</button>
    </div>
  {/if}
</div>

<style>
  /* "How it works" cards rise in, gently staggered (delay set per-card via --d). */
  .pc-step {
    opacity: 0;
    animation: pc-rise 0.55s cubic-bezier(0.2, 0.7, 0.3, 1) forwards;
    animation-delay: var(--d, 0ms);
  }
  @keyframes pc-rise {
    from { opacity: 0; transform: translateY(14px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .pc-step { animation: none; opacity: 1; }
  }
</style>
