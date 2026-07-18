<script lang="ts">
  import { ago } from '$lib/utils/time';
  import { FORMATS } from '$lib/formats';
  // Host-only panel: publish a game to the public /homegames city directory and
  // work the incoming request queue. Self-contained so the (large) game page only
  // needs to drop in <HostListing …/>. All calls go through the parent's `api`
  // helper (which carries the host token); `onUpdate` propagates the changed game
  // back so the rest of the page stays in sync.
  let {
    game,
    api,
    defaultCity = '',
    onUpdate = (_g: any) => {},
  }: {
    game: any;
    api: (method: string, path: string, body?: any) => Promise<any>;
    defaultCity?: string;
    onUpdate?: (g: any) => void;
  } = $props();

  const isPublic = $derived(game?.visibility === 'public');

  // Editable fields — seeded once; the host types freely from here.
  let cityInput = $state(game?.city || defaultCity || '');
  let formatInput = $state(game?.format || 'NLH');
  let maxInput = $state<number | ''>(game?.maxPlayers && game.maxPlayers > 0 ? game.maxPlayers : '');
  let minBuyInput = $state<number | ''>(game?.minBuyIn && game.minBuyIn > 0 ? game.minBuyIn : '');
  let maxBuyInput = $state<number | ''>(game?.maxBuyIn && game.maxBuyIn > 0 ? game.maxBuyIn : '');
  let smallBlindInput = $state<number | ''>(game?.blinds?.small ?? '');
  let bigBlindInput = $state<number | ''>(game?.blinds?.big ?? '');
  let busy = $state(false);
  let err = $state('');

  // The request queue (stripped from the public game payload — fetched here).
  let requests = $state<any[]>([]);
  let loadingReqs = $state(false);

  async function loadRequests() {
    if (!isPublic) { requests = []; return; }
    loadingReqs = true;
    try {
      const { requests: r } = await api('GET', `/api/games/${game.id}/join-request`);
      requests = r || [];
    } catch { /* host-only; ignore transient errors */ }
    finally { loadingReqs = false; }
  }

  // Load (and reload) the queue whenever the game becomes/stays public.
  $effect(() => { if (isPublic) loadRequests(); });

  async function save(nextVisibility: 'public' | 'private') {
    busy = true; err = '';
    try {
      const body: any = { visibility: nextVisibility };
      if (nextVisibility === 'public') {
        body.city = cityInput.trim();
        body.format = formatInput;
        body.maxPlayers = maxInput === '' ? 0 : Number(maxInput);
        body.minBuyIn = minBuyInput === '' ? 0 : Number(minBuyInput);
        // A max buy-in only means anything alongside a min; without a min it's cleared.
        body.maxBuyIn = minBuyInput === '' || maxBuyInput === '' ? 0 : Number(maxBuyInput);
        // Blind level (e.g. 1/2). Both must be set, else the level is cleared.
        body.smallBlind = smallBlindInput === '' ? 0 : Number(smallBlindInput);
        body.bigBlind = bigBlindInput === '' ? 0 : Number(bigBlindInput);
      }
      const g = await api('PUT', `/api/games/${game.id}/listing`, body);
      onUpdate(g);
      if (nextVisibility === 'public') loadRequests();
    } catch (e: any) {
      err = e.message || 'Could not update listing';
    } finally {
      busy = false;
    }
  }

  async function decide(rid: string, action: 'approve' | 'reject') {
    busy = true; err = '';
    try {
      await api('POST', `/api/games/${game.id}/join-request/${rid}`, { action });
      // Approve seats the player server-side; pull a fresh game so the roster updates.
      try { const g = await api('GET', `/api/games/${game.id}`); onUpdate(g); } catch {}
      await loadRequests();
    } catch (e: any) {
      err = e.message || 'Could not update request';
    } finally {
      busy = false;
    }
  }
</script>

<div class="card">
  <div class="flex items-center justify-between">
    <h3 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Public listing</h3>
    {#if isPublic}<span class="pill !border-accent/45 text-accent">Listed</span>{/if}
  </div>

  {#if !isPublic}
    <p class="text-muted text-sm mt-2">
      List this game on your city's <a href="/homegames">home-games page</a> so locals can
      request a seat. You approve every request — nobody joins without your say-so.
    </p>
    <div class="grid gap-2 mt-3 sm:grid-cols-3">
      <input class="input" placeholder="City (e.g. Amsterdam)" bind:value={cityInput} maxlength="60" />
      <select class="input" bind:value={formatInput} aria-label="Game">
        {#each FORMATS as f}<option value={f}>{f}</option>{/each}
      </select>
      <input class="input" type="number" min="2" max="50" placeholder="Max players" bind:value={maxInput} />
      <div class="flex items-center gap-1.5">
        <input class="input w-full" type="number" min="0" step="0.5" placeholder="SB" bind:value={smallBlindInput} aria-label="Small blind" />
        <span class="text-muted">/</span>
        <input class="input w-full" type="number" min="0" step="0.5" placeholder="BB" bind:value={bigBlindInput} aria-label="Big blind" />
      </div>
      <input class="input" type="number" min="0" placeholder="Min buy-in (blinds)" bind:value={minBuyInput} />
      {#if minBuyInput !== '' && Number(minBuyInput) > 0}
        <input class="input" type="number" min={minBuyInput} placeholder="Max buy-in (optional)" bind:value={maxBuyInput} />
      {/if}
    </div>
    {#if minBuyInput !== '' && Number(minBuyInput) > 0 && maxBuyInput === ''}
      <p class="text-faint text-xs mt-2">
        No max → <b>fixed buy-in</b>: everyone starts on {minBuyInput} blinds. Top-ups are allowed
        and the ceiling is up to you in-game.
      </p>
    {/if}
    <p class="text-faint text-xs mt-2">
      Open games are played in <b>blinds</b> — social play, no real-money stakes shown.
    </p>
    <button class="btn-small btn mt-3" disabled={busy || !cityInput.trim()} onclick={() => save('public')}>
      {busy ? 'Publishing…' : 'List publicly'}
    </button>
  {:else}
    <p class="text-muted text-sm mt-2">
      Listed in <b>{game.city}</b>{#if game.format} · {game.format}{/if}{#if game.blinds} · blinds {game.blinds.small}/{game.blinds.big}{/if}{#if game.maxPlayers} · max {game.maxPlayers} players{/if}{#if game.minBuyIn} · {#if game.maxBuyIn}{game.minBuyIn}–{game.maxBuyIn}{:else}{game.minBuyIn}{/if} blinds buy-in{#if game.minBuyIn && !game.maxBuyIn} (fixed){/if}{/if}.
    </p>

    {#if loadingReqs}
      <div class="skeleton h-[52px] mt-3"></div>
    {:else if requests.length}
      <div class="grid gap-2 mt-3">
        {#each requests as r (r.id)}
          <div class="transfer-row">
            <div class="min-w-0">
              <div class="font-semibold truncate">{r.name}{#if r.handle} <span class="text-muted font-normal">@{r.handle}</span>{/if}</div>
              {#if r.accountCreatedAt}
                <div class="text-xs text-faint" title="How long they've had a potcount account">Account created {ago(r.accountCreatedAt)}</div>
              {/if}
              {#if r.message}<div class="text-muted text-sm truncate">{r.message}</div>{/if}
              {#if r.mutual}
                {@const shown = r.mutual.users.slice(0, 3).map((u: any) => '@' + u.handle).join(', ')}
                <div class="text-xs text-win mt-0.5 truncate" title="People you've both played with before">
                  🤝 Also played with {shown}{r.mutual.count > 3 ? ` +${r.mutual.count - 3} more` : ''} — {r.mutual.count === 1 ? 'someone' : 'people'} you've played with
                </div>
              {/if}
            </div>
            <div class="ml-auto flex gap-1.5 shrink-0">
              <button class="btn-small btn" disabled={busy} onclick={() => decide(r.id, 'approve')}>Approve</button>
              <button class="btn-small btn-ghost" disabled={busy} onclick={() => decide(r.id, 'reject')}>Reject</button>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <p class="text-muted text-sm mt-3">No pending requests.</p>
    {/if}

    <button class="btn-small btn-ghost mt-3" disabled={busy} onclick={() => save('private')}>
      Stop listing
    </button>
  {/if}

  {#if err}<p class="text-danger text-sm mt-2">{err}</p>{/if}
</div>
