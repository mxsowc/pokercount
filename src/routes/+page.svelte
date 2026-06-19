<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { toast } from '$lib/stores/toast';
  import { money } from '$lib/utils/money';
  import { ago } from '$lib/utils/time';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';

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
    list.unshift({ id: game.id, name: game.name, unit: game.unit, you: getActor().name, players: game.players.length, status: game.status, at: Date.now() });
    if (list.length > 20) list.length = 20;
    localStorage.setItem('pc_games', JSON.stringify(list));
  }

  let games = $state(listMyGames());
  let actor = $state(getActor());

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
          id: sg.id, name: sg.name, unit: sg.unit,
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

  onMount(() => { unitInput = detectCurrencySymbol(); loadAccountGames(); });

  // Open game form
  let openName = $state('');
  let openGameName = $state('');
  let openCode = $state('');
  let openSeats = $state(0);

  // Currency: searchable, with custom entry. `unitInput` is what's used as the
  // game's unit — pick from the list or just type your own (e.g. "BTC", "chips").
  const CURRENCIES = [
    { s: '€', n: 'Euro' }, { s: '$', n: 'US Dollar' }, { s: '£', n: 'British Pound' },
    { s: 'zł', n: 'Polish Złoty' }, { s: 'CHF', n: 'Swiss Franc' }, { s: '¥', n: 'Japanese Yen / Chinese Yuan' },
    { s: '₹', n: 'Indian Rupee' }, { s: 'kr', n: 'Scandinavian Krone/Krona' }, { s: 'C$', n: 'Canadian Dollar' },
    { s: 'A$', n: 'Australian Dollar' }, { s: '₺', n: 'Turkish Lira' }, { s: 'R$', n: 'Brazilian Real' },
    { s: '₽', n: 'Russian Ruble' }, { s: '₩', n: 'Korean Won' }, { s: '₪', n: 'Israeli Shekel' },
    { s: 'Kč', n: 'Czech Koruna' }, { s: 'Ft', n: 'Hungarian Forint' }, { s: '฿', n: 'Thai Baht' },
    { s: 'R', n: 'South African Rand' }, { s: '₿', n: 'Bitcoin' },
    { s: 'BB', n: 'Big blinds' }, { s: 'chips', n: 'Chips (no money)' },
  ];
  let unitInput = $state('€');
  // Default the currency to the visitor's region (still changeable in More options).
  function detectCurrencySymbol(): string {
    try {
      const region = (navigator.language.split('-')[1] || '').toUpperCase();
      const map: Record<string, string> = {
        US: '$', GB: '£', CA: 'C$', AU: 'A$', NZ: '$', PL: 'zł', CH: 'CHF', JP: '¥',
        CN: '¥', IN: '₹', BR: 'R$', RU: '₽', KR: '₩', IL: '₪', CZ: 'Kč', HU: 'Ft',
        TH: '฿', ZA: 'R', TR: '₺', SE: 'kr', NO: 'kr', DK: 'kr',
      };
      return map[region] || '€';
    } catch { return '€'; }
  }
  let showUnits = $state(false);
  let unitActive = $state(-1);
  let unitMatches = $derived.by(() => {
    const q = unitInput.trim().toLowerCase();
    if (!q) return CURRENCIES;
    return CURRENCIES.filter((c) => c.s.toLowerCase().includes(q) || c.n.toLowerCase().includes(q));
  });
  function pickUnit(c: { s: string; n: string }) { unitInput = c.s; showUnits = false; unitActive = -1; }
  function onUnitKey(e: KeyboardEvent) {
    if (!showUnits || !unitMatches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); unitActive = (unitActive + 1) % unitMatches.length; }
    else if (e.key === 'ArrowUp') { e.preventDefault(); unitActive = (unitActive - 1 + unitMatches.length) % unitMatches.length; }
    else if (e.key === 'Enter' && unitActive >= 0) { e.preventDefault(); pickUnit(unitMatches[unitActive]); }
    else if (e.key === 'Escape') { showUnits = false; }
  }

  // Join game form
  let joinCode = $state('');
  let joinName = $state('');

  async function openGame() {
    const you = openName.trim();
    if (!you) { toast('Enter your name'); return; }
    setActorName(you);
    const players = [{ name: you }];
    for (let i = 0; i < openSeats; i++) players.push({ name: `Player ${i + 2}` });
    const code = openCode.replace(/[^0-9]/g, '');
    try {
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Actor-Id': getActor().id, 'X-Actor-Name': encodeURIComponent(you) },
        body: JSON.stringify({ name: openGameName.trim() || undefined, unit: unitInput.trim() || '€', players, code: code || undefined })
      });
      const game = await res.json();
      if (!res.ok) {
        // A custom code that's already in use → a game with it already exists.
        if (res.status === 409 && code) {
          toast(`A game with code #${code} is already running — pick another code or leave it blank.`);
        } else {
          toast(game.error || 'Failed');
        }
        return;
      }
      localStorage.setItem('pc_me_' + game.id, game.players[0].id);
      if (game.hostToken) localStorage.setItem('pc_host_' + game.id, game.hostToken);
      rememberGame(game);
      goto(`/game?g=${game.id}&new=1`);
    } catch (e: any) { toast(e.message); }
  }

  async function joinGame() {
    const code = joinCode.replace(/[^0-9]/g, '');
    const you = joinName.trim();
    if (code.length < 3) { toast('Enter the game code'); return; }
    if (!you) { toast('Enter your name'); return; }
    setActorName(you);
    try {
      const res = await fetch(`/api/games/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Actor-Id': getActor().id, 'X-Actor-Name': encodeURIComponent(you) },
        body: JSON.stringify({ name: you })
      });
      const data = await res.json();
      if (!res.ok) { toast(data.error?.includes('not found') ? `No game with code #${code}` : data.error || 'Failed'); return; }
      localStorage.setItem('pc_me_' + code, data.playerId);
      rememberGame(data.game);
      goto(`/game?g=${code}`);
    } catch (e: any) { toast(e.message); }
  }

  function forgetGame(id: string) {
    localStorage.setItem('pc_games', JSON.stringify(listMyGames().filter((g: any) => g.id !== id)));
    localStorage.removeItem('pc_me_' + id);
    localStorage.removeItem('pc_host_' + id);
    games = listMyGames();
  }

  function showOpen() {
    view = 'open';
    openName = getActor().name;
  }
  function showJoin() {
    view = 'join';
    joinName = getActor().name;
  }
</script>

<svelte:head>
  <title>potcount — home game tracker</title>
</svelte:head>

<div class="wrap">
  {#if view === 'intro'}
    <section class="min-h-[calc(80vh-60px)] flex flex-col items-center justify-center max-md:block max-md:min-h-0 max-md:pt-3.5">
      <h1 class="text-[clamp(2.8rem,11vw,4.2rem)] font-bold tracking-tight leading-tight mb-2 text-center max-md:text-left"
          style="font-family: var(--font-display); letter-spacing: -0.04em;">
        pot<span class="text-accent font-bold">count</span>
      </h1>
      <p class="text-muted text-[1.05rem] max-w-[48ch] text-center max-md:text-left mb-5 w-full">
        Track buy-ins and top-ups. At the end it works out who pays who — and who had the best night.
      </p>

      {#if games.length > 0}
        <div class="w-full mb-5">
          <h3 class="text-xs font-semibold uppercase tracking-widest text-muted mb-2">Your games</h3>
          {#each games as g (g.id)}
            <a href="/game?g={g.id}" class="player-row no-underline text-text hover:border-border active:scale-[.99] transition-transform">
              <div>
                <div class="font-semibold">{g.name || 'Home Game'} <span class="text-accent font-bold tracking-widest text-sm" style="font-family: var(--font-display)">#{g.id}</span></div>
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

      <div class="flex flex-col gap-2.5 w-full max-w-[400px] mx-auto mt-5">
        <button class="btn w-full py-[18px] text-[1.1rem]" onclick={showOpen}>Open a game</button>
        <button class="btn btn-secondary w-full py-[18px] text-[1.1rem]" onclick={showJoin}>Join a game</button>
      </div>
      <p class="text-muted text-xs text-center mt-5 max-w-[48ch] mx-auto">
        Games live on the server — anyone with the code can keep adding and settle later, even after the host closes the app.
      </p>
    </section>

  {:else if view === 'open'}
    <button class="btn-small btn-ghost mb-3" onclick={() => view = 'intro'}>← Back</button>
    <h1 class="text-2xl font-bold mb-1">Open a game</h1>
    <p class="text-muted mb-4">You'll get a code to share. Everyone else just joins with it.</p>
    <div class="card">
      <label class="block text-xs text-muted font-medium mb-1 mt-3">Your name</label>
      <input class="input" bind:value={openName} placeholder="e.g. Max" maxlength="40" />
      <label class="block text-xs text-muted font-medium mb-1 mt-3">Game name</label>
      <input class="input" bind:value={openGameName} placeholder="Friday Night PLO" />
      <details class="mt-3">
        <summary class="text-sm text-muted cursor-pointer">More options</summary>

        <!-- Currency: searchable + custom -->
        <label class="block text-xs text-muted font-medium mb-1 mt-3">Currency</label>
        <div class="relative">
          <input class="input w-full" bind:value={unitInput} placeholder="€, $, zł, BB, chips…" autocomplete="off"
                 oninput={() => { showUnits = true; unitActive = -1; }}
                 onfocus={() => { showUnits = true; }}
                 onkeydown={onUnitKey}
                 onblur={() => setTimeout(() => showUnits = false, 150)} />
          {#if showUnits && unitMatches.length}
            <div class="absolute left-0 right-0 top-full mt-1 z-30 card !p-1 max-h-56 overflow-auto shadow-xl">
              {#each unitMatches as c, i (c.s)}
                <button type="button"
                        class="flex items-center gap-2.5 w-full text-left px-2.5 py-2 rounded-lg {i === unitActive ? 'bg-surface-2' : 'hover:bg-surface-2'} transition-colors"
                        onmousedown={(e) => { e.preventDefault(); pickUnit(c); }}>
                  <span class="w-9 shrink-0 font-bold tabular-nums">{c.s}</span>
                  <span class="text-muted text-sm truncate">{c.n}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        <p class="text-muted text-xs mt-1">Pick one or type your own — it can even be “big blinds”, “chips”, anything.</p>

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
      <button class="btn w-full mt-4" onclick={openGame}>Open game</button>
    </div>

  {:else if view === 'join'}
    <button class="btn-small btn-ghost mb-3" onclick={() => view = 'intro'}>← Back</button>
    <h1 class="text-2xl font-bold mb-1">Join a game</h1>
    <p class="text-muted mb-4">Enter the code the host shared and your name.</p>
    <div class="card">
      <label class="block text-xs text-muted font-medium mb-1 mt-3">Game code</label>
      <input class="input tracking-widest text-xl" bind:value={joinCode} inputmode="numeric" placeholder="2137" maxlength="6"
             onkeydown={(e) => { if (e.key === 'Enter') joinGame(); }} />
      <label class="block text-xs text-muted font-medium mb-1 mt-3">Your name</label>
      <input class="input" bind:value={joinName} placeholder="e.g. Max" maxlength="40"
             onkeydown={(e) => { if (e.key === 'Enter') joinGame(); }} />
      <button class="btn w-full mt-4" onclick={joinGame}>Join game</button>
    </div>
  {/if}
</div>
