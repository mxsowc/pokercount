<script lang="ts">
  import { page } from '$app/stores';
  import { goto, afterNavigate, replaceState } from '$app/navigation';
  import { toast } from '$lib/stores/toast';
  import { ago } from '$lib/utils/time';
  import { money } from '$lib/utils/money';
  import { browser } from '$app/environment';
  import { onMount } from 'svelte';
  import CurrencyPicker from '$lib/components/CurrencyPicker.svelte';
  import CityPicker from '$lib/components/CityPicker.svelte';
  import { FORMATS } from '$lib/formats';
  import { currencyForCountry } from '$lib/utils/currencies';
  import { citySlug, cityLabel } from '$lib/cities.js';
  import { nearestCity } from '$lib/city-coords';

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
    list.unshift({ id: game.id, code: game.code ?? game.id, name: game.name, unit: game.unit, you: getActor().name, players: game.players.length, status: game.status, at: Date.now(), scheduledFor: game.scheduledFor ?? null });
    if (list.length > 20) list.length = 20;
    localStorage.setItem('pc_games', JSON.stringify(list));
  }

  let games = $state(listMyGames());
  // Home "Your games" is a quick jump-back list, not full history: show active
  // games (any age) plus anything touched in the last 24h. Older finished games
  // still live on your profile — they're just kept out of the way here.
  const DAY_MS = 24 * 60 * 60 * 1000;
  // A finished game where YOU still owe money or still have to confirm a payment
  // isn't really "done" for you — it stays open business.
  const needsAction = (g: any) => (g.youOwe || 0) > 0 || (g.youConfirm || 0) > 0;
  const recentGames = $derived(
    games
      .filter((g: any) => {
        if (g.status === 'scheduled') return false; // upcoming plans live in "Planned games"
        if (g.status === 'active') return true;
        if (needsAction(g)) return true; // unresolved money keeps a finished game visible, even past 24h
        const t = new Date(g.at).getTime();
        return !Number.isFinite(t) || Date.now() - t < DAY_MS; // keep if recent (or timestamp unknown)
      })
      // Active first, then finished-games-you-owe-on, then the rest (stable — keeps recency order within each).
      .sort((a: any, b: any) => {
        const rank = (g: any) => (g.status === 'active' ? 0 : needsAction(g) ? 1 : 2);
        return rank(a) - rank(b);
      })
  );
  // Scheduled games you host or RSVP'd to — your upcoming schedule, soonest first.
  const plannedGames = $derived(
    [...games.filter((g: any) => g.status === 'scheduled')]
      .sort((a: any, b: any) => new Date(a.scheduledFor || a.at).getTime() - new Date(b.scheduledFor || b.at).getTime())
  );
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
          scheduledFor: sg.scheduledFor ?? prev.scheduledFor ?? null,
          at: prev.at ?? sg.at,   // keep local recency if we have it
          linked: true,           // account-linked: removed by "leaving" the game, not a local ✕
          youOwe: sg.youOwe ?? 0,        // still-open money actions for this seat (finished games)
          youConfirm: sg.youConfirm ?? 0,
        });
      }
      const rank = (s: string) => (s === 'active' ? 0 : s === 'ended' ? 1 : 2);
      games = [...byId.values()].sort(
        (a, b) => rank(a.status) - rank(b.status) || (new Date(b.at).getTime() || 0) - (new Date(a.at).getTime() || 0)
      );
    } catch {}
  }

  // Drop "ghost" entries: games this device remembers locally (pc_games) that the
  // server no longer has — e.g. an abandoned single-player / no-buy-in table the
  // cleanup reaper deleted after 24h. Without this they linger on the home list
  // with a dead "Continue" button (and never appear in admin, which reads live).
  async function pruneDeletedGames() {
    if (!browser) return;
    const local = listMyGames();
    if (!local.length) return;
    try {
      const res = await fetch('/api/games/exists', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: local.map((g: any) => g.id) }),
      });
      if (!res.ok) return; // never prune on a failed/absent response — only on a confirmed answer
      const { existing } = await res.json();
      const keep = new Set<string>(existing || []);
      const pruned = local.filter((g: any) => keep.has(g.id));
      if (pruned.length !== local.length) {
        localStorage.setItem('pc_games', JSON.stringify(pruned));
        games = games.filter((g: any) => keep.has(g.id));
      }
    } catch {}
  }

  // Home-game join requests this account has sent — so a pending/declined request
  // is visible somewhere (approved ones also show up seated in the lists above).
  let sentRequests = $state<any[]>([]);
  async function loadSentRequests() {
    if (!browser || !user) return;
    try {
      const res = await fetch('/api/me/join-requests');
      if (res.ok) sentRequests = (await res.json()).requests || [];
    } catch {}
  }

  // Format an instant as a datetime-local input value (local YYYY-MM-DDTHH:mm).
  function localInputValue(d = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  // Compact planned-time label for the schedule, e.g. "Sat 12 Jul, 20:00".
  function whenShort(iso: string | null | undefined): string {
    if (!iso) return 'Planned';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Planned';
    return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  }

  onMount(() => {
    unitInput = defaultUnit();
    minSchedule = localInputValue();
    nudgeDismissed = !!localStorage.getItem('pc_host_nudge_dismissed');
    if (user?.city) openCity = user.city;
    // Prune server-deleted ghosts first, then fold in account-linked games.
    pruneDeletedGames().then(loadAccountGames);
    loadSentRequests();
    // Deep links into the create form (?start=open / ?host=open&city=…) are applied
    // by afterNavigate, which also fires on this initial load.
  });

  // Open game form
  let openName = $state('');
  let openCode = $state('');
  let openSeats = $state(0);
  let openSeries = $state('');
  let openNote = $state(''); // optional host note shown to players (address, BYO chips…)
  let openBuyIn = $state(''); // table's standard buy-in → seeds the quick-buy on the game page
  // Schedule-for-later: when on, the game is created as a `scheduled` invite lobby
  // (people RSVP) instead of opening live. `openSchedule` is a datetime-local
  // value; `minSchedule` stops the picker choosing a time already past.
  let scheduling = $state(false);
  let openSchedule = $state('');
  let minSchedule = $state('');
  // Open game (public/city directory) fields
  let isOpenGame = $state(false);
  let openCity = $state('');
  let openSmallBlind = $state('');
  let openBigBlind = $state('');
  let openMaxPlayers = $state('');
  let openMinBuyIn = $state('');
  let openMaxBuyIn = $state('');
  let openFormat = $state('NLH'); // poker variant for the open game — NLH is the standard

  // Convenience: map the device's location to the nearest curated city (first-party,
  // no third-party geocoding) and pre-fill the city field.
  let geoBusy = $state(false);
  function useMyLocation() {
    if (!browser || !navigator.geolocation) { toast('Location not available on this device'); return; }
    geoBusy = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        geoBusy = false;
        const near = nearestCity(pos.coords.latitude, pos.coords.longitude);
        if (near) { openCity = cityLabel(near.slug, ''); toast(`Nearest city: ${openCity}`); }
        else toast("Couldn't match your location to a listed city — type it in");
      },
      () => { geoBusy = false; toast('Location permission denied'); },
      { timeout: 8000, maximumAge: 300000 }
    );
  }

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
    if (isOpenGame) {
      if (!user) { toast('Sign in to create an open game'); return; }
      if (!openCity.trim()) { toast('Enter a city for your open game'); return; }
      if (!openSmallBlind || !openBigBlind || Number(openSmallBlind) <= 0 || Number(openBigBlind) <= 0) { toast('Set the blinds for your open game'); return; }
    }
    // Scheduling? Require a future date. A scheduled game opens as an empty RSVP
    // lobby, so we seat only the host (no filler "Player 2" seats).
    let scheduledFor: string | undefined;
    if (scheduling) {
      const when = new Date(openSchedule).getTime();
      if (!openSchedule || !Number.isFinite(when)) { toast('Pick a date and time'); return; }
      if (when < Date.now() - 60_000) { toast('Pick a time in the future'); return; }
      scheduledFor = new Date(when).toISOString();
    }
    if (busy) return;
    busy = true;
    setActorName(you);
    const players = [{ name: you }];
    if (!scheduling) for (let i = 0; i < openSeats; i++) players.push({ name: `Player ${i + 2}` });
    const code = openCode.replace(/[^0-9]/g, '');
    const buyIn = Number(String(openBuyIn).replace(',', '.').trim());
    try {
      const payload: any = { name: generatedTitle, unit: unitInput.trim() || '€', players, code: code || undefined, defaultBuyIn: buyIn > 0 ? buyIn : undefined, scheduledFor, source: getAcq() || undefined };
      if (openNote.trim()) payload.note = openNote.trim();
      if (isOpenGame && openCity.trim()) {
        payload.visibility = 'public';
        payload.city = openCity.trim();
        payload.format = openFormat; // defaults to NLH
        const sb = Number(openSmallBlind), bb = Number(openBigBlind);
        if (sb > 0) payload.smallBlind = sb;
        if (bb > 0) payload.bigBlind = bb;
        const mp = Number(openMaxPlayers);
        if (mp >= 2) payload.maxPlayers = mp;
        const mi = Number(openMinBuyIn);
        if (mi > 0) payload.minBuyIn = mi;
        const ma = Number(openMaxBuyIn);
        if (ma > 0) payload.maxBuyIn = ma;
      }
      const res = await fetch('/api/games', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Actor-Id': getActor().id, 'X-Actor-Name': encodeURIComponent(you) },
        body: JSON.stringify(payload)
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
      if (scheduling) toast('Game scheduled — share the invite link');
      // An open/public game lives on its city directory (that's where locals find
      // it and request a seat, and the shareable page) — land the host there,
      // with their new table already listed. Private games go straight to the
      // table to start tracking.
      if (isOpenGame && openCity.trim()) {
        goto(`/homegames/${citySlug(openCity)}`);
      } else {
        goto(`/game?g=${game.id}&new=1`);
      }
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

  // The create/join screens are a client-side `view` on the `/` route, not their
  // own URL. Mirror the view into a `?start=` query param so that navigating home
  // (clicking the potcount logo / bottom-nav home → href="/") is a REAL URL change
  // that resets the view — otherwise the logo resolves to the same URL and the
  // form just stays put. `afterNavigate` below is what applies the reset.
  function setViewUrl(v: View) {
    if (!browser) return;
    const url = new URL(location.href);
    url.searchParams.delete('host');
    if (v === 'open') url.searchParams.set('start', 'open');
    else if (v === 'join') url.searchParams.set('start', 'join');
    else url.searchParams.delete('start');
    const next = url.pathname + url.search;
    if (next !== location.pathname + location.search) replaceState(next, {});
  }

  function showOpen() {
    view = 'open';
    openName = user?.displayName || getActor().name;
    generatedTitle = gameTitle();
    setViewUrl('open');
  }
  function showJoin() {
    view = 'join';
    joinName = getActor().name;
    setViewUrl('join');
  }
  function backToDashboard() {
    view = 'intro';
    setViewUrl('intro');
  }

  // Derive the view from the URL on every navigation (incl. the initial load and
  // the logo/home click). replaceState from setViewUrl doesn't fire this, so
  // there's no loop — only genuine navigations reset the screen.
  afterNavigate(() => {
    if (!browser || $page.url.pathname !== '/') return;
    const sp = $page.url.searchParams;
    const city = sp.get('city');
    if (city) openCity = city;
    if (sp.get('host') === 'open') { isOpenGame = true; showOpen(); }
    else if (sp.get('start') === 'open') showOpen();
    else if (sp.get('start') === 'join') showJoin();
    else backToDashboard();
  });
</script>

<svelte:head>
  <title>potcount — poker home game tracker & who-pays-who settlement</title>
  <meta name="description" content="potcount keeps score at your home poker nights — track every player's record over time and open your games so friends can join. Free, social, just for fun. 18+." />
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
        Home game poker tracker, counter &amp; stats
      </p>
      <p class="text-muted text-[1.05rem] max-w-[50ch] text-center max-md:text-left mb-5 w-full">
        Keep score at your poker night, track everyone's record over time, and open your games so friends can join. Free, social, and just for fun.
      </p>

      {#if recentGames.length > 0}
        <div class="w-full mb-5">
          <h3 class="sub-label mb-2">Your games</h3>
          {#each recentGames as g (g.id)}
            {@const finished = g.status === 'ended' || g.status === 'settled'}
            <a href="/game?g={g.id}" class="player-row no-underline text-text hover:border-border active:scale-[.99] transition-transform {needsAction(g) ? '!border-warn/50' : ''}">
              <div>
                <div class="font-semibold">{g.name || 'Home Game'} <span class="text-accent font-bold tracking-widest text-sm font-display">#{g.code ?? g.id}</span></div>
                <div class="text-muted text-xs mt-0.5">{g.you ? `you: ${g.you} · ` : ''}{g.players} players · {ago(new Date(g.at).toISOString())}{finished ? ' · finished' : ''}</div>
              </div>
              <div class="flex items-center gap-2">
                {#if g.youOwe > 0}
                  <span class="pill pill-warn">You owe {money(g.youOwe, g.unit)}</span>
                {:else if g.youConfirm > 0}
                  <span class="pill pill-warn">Confirm received</span>
                {/if}
                <span class="pill {finished ? '' : 'pill-win'}">{finished ? 'View →' : 'Continue →'}</span>
                {#if !g.linked}
                  <button class="btn-small btn-danger" onclick={(e) => { e.preventDefault(); if (confirm(`Remove "${g.name || 'Home Game'}" from your list?`)) forgetGame(g.id); }}>✕</button>
                {/if}
              </div>
            </a>
          {/each}
          {#if games.length > recentGames.length + plannedGames.length}
            {@const hidden = games.length - recentGames.length - plannedGames.length}
            <a href={user ? `/u/${user.handle}` : '/account'} class="text-muted text-xs mt-1 block hover:text-text">{hidden} older game{hidden !== 1 ? 's' : ''} on your profile →</a>
          {/if}
        </div>
      {/if}

      {#if plannedGames.length > 0}
        <div class="w-full mb-5">
          <h3 class="sub-label mb-2">📅 Planned games</h3>
          {#each plannedGames as g (g.id)}
            <a href="/game?g={g.id}" class="player-row no-underline text-text hover:border-border active:scale-[.99] transition-transform">
              <div>
                <div class="font-semibold">{g.name || 'Home Game'} <span class="text-accent font-bold tracking-widest text-sm font-display">#{g.code ?? g.id}</span></div>
                <div class="text-muted text-xs mt-0.5">{whenShort(g.scheduledFor)} · {g.players} going</div>
              </div>
              <span class="pill pill-warn">RSVP →</span>
            </a>
          {/each}
        </div>
      {/if}

      <!-- Home-game requests you've sent (approved ones also appear seated above). -->
      {#if sentRequests.length > 0}
        <div class="w-full mb-5">
          <h3 class="sub-label mb-2">🃏 Requests you've sent</h3>
          {#each sentRequests as r (r.gameId)}
            <a href="/g/{r.gameId}" class="player-row no-underline text-text hover:border-border">
              <div class="min-w-0">
                <div class="font-semibold truncate">{r.name}{#if r.city} <span class="text-muted font-normal">· {r.city}</span>{/if}</div>
                <div class="text-muted text-xs mt-0.5">
                  {r.format}{#if r.blinds} · {r.blinds.small}/{r.blinds.big} blinds{/if}{#if r.host} · {r.host.displayName}{/if}
                </div>
              </div>
              {#if r.status === 'approved'}
                <span class="pill pill-win shrink-0">✓ Approved</span>
              {:else if r.status === 'rejected'}
                <span class="pill pill-lose shrink-0">Declined</span>
              {:else}
                <span class="pill shrink-0">Waiting</span>
              {/if}
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
        <a href="/homegames" class="text-center text-sm text-muted hover:text-text mt-0.5 no-underline">Browse home games near you →</a>
      </div>

      <!-- Community layer, framed as social play among friends (stat-keeping, not
           money/stakes): a host opens a game, friends request to join, 18+. -->
      {#if !user}
        <div class="w-full max-w-[560px] mx-auto mt-8 card !bg-surface-2 text-center">
          <h2 class="text-lg font-bold">Open your games to friends</h2>
          <p class="text-muted text-sm mt-1.5 max-w-[48ch] mx-auto">
            Start a game and share it — friends (and friends of friends) can request a seat. Make a free account to keep your stats and track your record across every night.
          </p>
          <p class="text-xs text-faint mt-2">Social play · just for fun · hosts approve every player · 18+</p>
          <div class="flex flex-col sm:flex-row gap-2.5 justify-center mt-4">
            <a href="/account" class="btn no-underline">Create your free account</a>
            <a href="/homegames" class="btn btn-secondary no-underline">Browse home games →</a>
          </div>
        </div>
      {/if}

      {#if games.length === 0}
        <!-- How it works — new visitors only; supports the CTA, doesn't replace it -->
        <div class="w-full max-w-[620px] mx-auto mt-10">
          <h2 class="sub-label text-center mb-4">How it works</h2>
          <div class="grid grid-cols-3 gap-3 max-md:grid-cols-1 max-md:gap-2.5">
            <div class="pc-step bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5" style="--d:0ms">
              <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">🎴</div>
              <div>
                <div class="font-semibold text-sm">Open a game</div>
                <div class="text-muted text-xs mt-1 leading-snug">Name it and get a 4-digit code.</div>
              </div>
            </div>
            <div class="pc-step bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5" style="--d:90ms">
              <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">📊</div>
              <div>
                <div class="font-semibold text-sm">Keep score</div>
                <div class="text-muted text-xs mt-1 leading-snug">Everyone logs their own chips as you play — one shared scoreboard, no arguments.</div>
              </div>
            </div>
            <div class="pc-step bg-surface-2 border border-border rounded-2xl p-4 text-center max-md:flex max-md:items-center max-md:text-left max-md:gap-3.5 max-md:p-3.5" style="--d:180ms">
              <div class="w-11 h-11 rounded-full grid place-items-center text-xl bg-accent/15 mx-auto mb-2.5 max-md:m-0 max-md:shrink-0">🏆</div>
              <div>
                <div class="font-semibold text-sm">See the results</div>
                <div class="text-muted text-xs mt-1 leading-snug">At the end you get each player's result and who had the best night.</div>
              </div>
            </div>
          </div>
          <p class="text-muted text-xs text-center mt-5 max-w-[48ch] mx-auto">
            Just splitting one pot right now? The <a href="/pot">Split tool</a> does it instantly — no game needed.
          </p>
          <p class="text-muted text-xs text-center mt-1.5 max-w-[48ch] mx-auto">
            New to this? Read the <a href="/guide">step-by-step guides</a>, or about the <a href="/home-game-poker">home game poker</a> tracker, <a href="/poker-counter">poker counter</a> and <a href="/poker-chip-tracker">chip tracker</a>.
          </p>
          <p class="text-muted text-xs text-center mt-1.5 max-w-[48ch] mx-auto">
            Looking for a game near you? <a href="/homegames">Find a home poker game by city</a>.
          </p>
        </div>
      {/if}

      <p class="text-muted text-xs text-center mt-5 max-w-[48ch] mx-auto">
        Games live on the server — anyone with the code can keep score and check the results later, even after the host closes the app.
      </p>

      <!-- Legal footer: potcount is a social scorekeeper + community, not a gambling
           operator. Required framing per NL (Wet op de kansspelen) + a link to the
           full Terms/Privacy where the operator imprint lives. -->
      <footer class="w-full max-w-[56ch] mx-auto mt-10 pt-5 border-t border-border-soft text-center">
        <p class="text-xs text-faint leading-relaxed">
          potcount is a free social scorekeeping tool and community for home poker — not a gambling operator. We don't organise or run games, and never hold or handle money or stakes. Public home games are social play in blinds only, with no real-money stakes set, shown, or handled by potcount; hosts run their own tables and approve who joins. 18+ only — you're responsible for the lawfulness of any game you host, list, or join. See our <a href="/terms">Terms</a> and <a href="/privacy">Privacy</a>.
        </p>
        <p class="text-xs text-faint mt-2">Operated by FatCloud</p>
      </footer>
    </section>

  {:else if view === 'open'}
    <button class="btn-small btn-ghost mb-3" onclick={backToDashboard}>← Back</button>
    <h1 class="text-2xl font-bold mb-1">Open a game</h1>
    <p class="text-muted mb-4">{isOpenGame ? 'Listed publicly — locals in your city can request to join.' : 'You’ll get a code to share. Everyone else just joins with it.'}</p>
    <div class="card">
      <div class="flex items-center gap-2 mb-3">
        <span class="text-muted text-sm flex-1 italic truncate">{generatedTitle}</span>
        <button type="button" class="btn-small btn-secondary !py-1.5 !px-2.5 shrink-0" onclick={() => generatedTitle = gameTitle()} title="Shuffle title">🔀</button>
      </div>
      <label class="block text-xs text-muted font-medium mb-1">Your name</label>
      <input class="input" bind:value={openName} placeholder="e.g. Max" maxlength="40" autocapitalize="words" autocomplete="name" enterkeyhint="done" />

      <!-- Game type: Private (code-only) vs Open (city directory) -->
      <div class="seg grid-cols-2 mt-3">
        <button type="button" class="seg-item {!isOpenGame ? 'is-active' : ''}" onclick={() => isOpenGame = false}>Private game</button>
        <button type="button" class="seg-item {isOpenGame ? 'is-active' : ''}" onclick={() => isOpenGame = true}>Open game</button>
      </div>
      {#if isOpenGame}
        <p class="text-xs text-faint mt-1">Listed on the <a href="/homegames">home games</a> directory. Players request to join — you approve who sits down. Currency is set to blinds.</p>
        {#if !user}
          <div class="banner banner-warn mt-2">You need to <a href="/account?next=/?start=open">sign in</a> to create an open game.</div>
        {/if}

        <div class="flex items-center justify-between mb-1 mt-3">
          <label class="block text-xs text-muted font-medium" for="open-city">City</label>
          <button type="button" class="text-xs text-accent hover:underline disabled:opacity-50" disabled={geoBusy} onclick={useMyLocation}>
            {geoBusy ? 'Locating…' : '📍 Use my location'}
          </button>
        </div>
        <CityPicker bind:value={openCity} id="open-city" placeholder="Start typing — e.g. Amsterdam" />

        <label class="block text-xs text-muted font-medium mb-1 mt-3" for="open-format">Game</label>
        <select id="open-format" class="input" bind:value={openFormat}>
          {#each FORMATS as f}<option value={f}>{f}</option>{/each}
        </select>

        <div class="flex gap-2.5 mt-3">
          <div class="flex-1">
            <label class="block text-xs text-muted font-medium mb-1">Small blind</label>
            <input class="input" bind:value={openSmallBlind} inputmode="decimal" placeholder="e.g. 1" />
          </div>
          <div class="flex-1">
            <label class="block text-xs text-muted font-medium mb-1">Big blind</label>
            <input class="input" bind:value={openBigBlind} inputmode="decimal" placeholder="e.g. 2" />
          </div>
        </div>

        <div class="flex gap-2.5 mt-3">
          <div class="flex-1">
            <label class="block text-xs text-muted font-medium mb-1">Max players</label>
            <input class="input" bind:value={openMaxPlayers} inputmode="numeric" placeholder="e.g. 8" />
          </div>
          <div class="flex-1">
            <label class="block text-xs text-muted font-medium mb-1">Min buy-in (blinds)</label>
            <input class="input" bind:value={openMinBuyIn} inputmode="decimal" placeholder="e.g. 100" />
          </div>
        </div>
        <div class="mt-3">
          <label class="block text-xs text-muted font-medium mb-1">Max buy-in (blinds, optional)</label>
          <input class="input" bind:value={openMaxBuyIn} inputmode="decimal" placeholder="Leave empty for fixed buy-in" />
          <p class="text-xs text-faint mt-1">Empty = fixed buy-in at the minimum. Set a max for a range (e.g. 100–200).</p>
        </div>
      {/if}

      <div class="seg grid-cols-2 mt-3">
        <button type="button" class="seg-item {!scheduling ? 'is-active' : ''}" onclick={() => scheduling = false}>Start now</button>
        <button type="button" class="seg-item {scheduling ? 'is-active' : ''}" onclick={() => scheduling = true}>Schedule</button>
      </div>
      {#if scheduling}
        <label class="block text-xs text-muted font-medium mb-1 mt-3">When</label>
        <input class="input" type="datetime-local" bind:value={openSchedule} min={minSchedule} />
        <p class="text-xs text-faint mt-1">Creates an invite lobby people can RSVP to. You start the table on the night — buy-ins begin then.</p>
      {/if}

      <details class="mt-3">
        <summary class="text-sm text-muted cursor-pointer">More options</summary>

        <!-- Host note: any specifics for players (address, "BYO chips", parking…). -->
        <label class="block text-xs text-muted font-medium mb-1 mt-3" for="open-note">Note for players (optional)</label>
        <textarea id="open-note" class="input min-h-[68px] resize-y" bind:value={openNote} maxlength="500"
                  placeholder={scheduling ? 'e.g. My place, 8pm — buzzer 3B. BYO chips. Parking on the street.' : 'e.g. BYO chips. Snacks provided.'}></textarea>
        <p class="text-xs text-faint mt-1">Shown to everyone who opens the game{#if isOpenGame} or its directory listing{/if}.</p>

        {#if !isOpenGame}
          <!-- Currency: searchable + custom (hidden for open games — forced to blinds) -->
          <label class="block text-xs text-muted font-medium mb-1 mt-3">Currency</label>
          <CurrencyPicker bind:value={unitInput} />
          <p class="text-muted text-xs mt-1">Pick one or type your own — it can even be "big blinds", "chips", anything.</p>
        {/if}

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
      <button class="btn w-full mt-4" disabled={busy || (isOpenGame && !user)} onclick={openGame}>{busy ? (scheduling ? 'Scheduling...' : 'Creating...') : isOpenGame ? (scheduling ? 'Schedule & list publicly' : 'Create & list publicly') : (scheduling ? 'Schedule game' : 'Open game')}</button>
    </div>

  {:else if view === 'join'}
    <button class="btn-small btn-ghost mb-3" onclick={backToDashboard}>← Back</button>
    <h1 class="text-2xl font-bold mb-1">Join a game</h1>
    <p class="text-muted mb-4">Enter the code the host shared — or browse open games in your city.</p>
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

    <!-- No code? Browse the public city directory instead. -->
    <div class="flex items-center gap-3 my-6 text-muted text-xs">
      <span class="h-px bg-border flex-1"></span> or <span class="h-px bg-border flex-1"></span>
    </div>
    <div class="rounded-2xl border border-border-soft p-4 text-center">
      {#if user?.city}
        <a href="/homegames/{citySlug(user.city)}" class="btn btn-secondary w-full no-underline">Browse open home games →</a>
        <p class="text-faint text-xs mt-3 leading-relaxed">Public tables in {user.city} — request a seat, the host approves.<br />You can search other cities there too.</p>
      {:else}
        <a href="/homegames" class="btn btn-secondary w-full no-underline">Browse open home games →</a>
        <p class="text-faint text-xs mt-3 leading-relaxed">Find a public table near you and request a seat. <a href="/account">Set your city</a> to jump straight to it.</p>
      {/if}
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
