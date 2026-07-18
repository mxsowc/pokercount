<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { fmtSigned } from '$lib/utils/money';
  import CityPicker from '$lib/components/CityPicker.svelte';
  import { citySlug } from '$lib/cities.js';

  let { data } = $props();

  // Browse another city: type/pick a city and jump to its directory page.
  let searchCity = $state('');
  function goCity(e: Event) {
    e.preventDefault();
    const c = searchCity.trim();
    if (c) goto(`/homegames/${citySlug(c)}`);
  }
  const label = $derived(data.label as string);
  const slug = $derived(data.slug as string);
  // Directory is data-minimised: handle only (no real name / photo on the indexed
  // page). Full profile is one click deeper at /u/[handle].
  const playerCount = $derived((data.playerCount ?? 0) as number);
  const topPlayers = $derived(
    (data.topPlayers ?? null) as { rank: number; handle: string; net: number; games: number; you: boolean }[] | null
  );
  const openGames = $derived(
    (data.openGames ?? []) as { id: string; name: string; seated: number; maxPlayers: number; minBuyIn: number; maxBuyIn: number; blinds: { small: number; big: number } | null; scheduledFor: string | null; host: { handle: string; displayName: string; avatar: string | null } | null; roster: { name: string; handle: string | null }[]; note?: string | null; youRequested?: boolean; youSeated?: boolean }[]
  );
  const indexable = $derived(data.indexable as boolean);
  const user = $derived($page.data?.user ?? null);

  const canonical = $derived(`https://potcount.com/homegames/${slug}`);

  // Request-to-join state, keyed by game id: 'busy' | 'sent' | error string.
  // Local optimistic overrides only; the persisted truth comes from the server
  // (youRequested / youSeated), so a reload still shows "Request sent".
  let reqState = $state<Record<string, string>>({});
  const joinState = (g: { id: string; youRequested?: boolean; youSeated?: boolean }) =>
    reqState[g.id] ?? (g.youSeated ? 'seated' : g.youRequested ? 'sent' : 'idle');
  async function requestJoin(gameId: string) {
    if (reqState[gameId] === 'busy' || reqState[gameId] === 'sent') return;
    reqState = { ...reqState, [gameId]: 'busy' };
    try {
      const res = await fetch(`/api/games/${gameId}/join-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not send request');
      reqState = { ...reqState, [gameId]: 'sent' };
    } catch (e: any) {
      reqState = { ...reqState, [gameId]: e.message || 'Could not send request' };
    }
  }

  function seatsLabel(g: { seated: number; maxPlayers: number }) {
    return g.maxPlayers > 0 ? `${g.seated}/${g.maxPlayers} seats` : `${g.seated} seated`;
  }
  // Buy-in label in blinds: a range when a max is set, else a fixed amount.
  function buyInLabel(g: { minBuyIn: number; maxBuyIn: number }) {
    if (!g.minBuyIn) return '';
    return g.maxBuyIn > 0 ? `${g.minBuyIn}–${g.maxBuyIn} blinds` : `${g.minBuyIn} blinds`;
  }

  const faqs = $derived([
    {
      q: `How do I find a home poker game in ${label}?`,
      a: `Browse the local players below, follow the ones you know, and join their next game with a single code. If there isn't a game running yet, start one — it's free.`,
    },
    {
      q: `Is potcount free?`,
      a: `Yes. potcount keeps score for the whole table and tracks each player's record over time. There's nothing to install and no account needed to join a game.`,
    },
    {
      q: `Can I host my own home game in ${label}?`,
      a: `Absolutely. Open a table, share one code with your friends, and everyone keeps their own score in real time. Social play, blinds only.`,
    },
  ]);

  // Structured data: breadcrumb + the roster as an ItemList + the FAQ. Serialized
  // with < escaped so a display name can never break out of the <script> tag.
  const jsonLd = $derived(
    '<' + 'script type="application/ld+json">' +
    JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home games', item: 'https://potcount.com/homegames' },
            { '@type': 'ListItem', position: 2, name: label, item: canonical },
          ],
        },
        {
          '@type': 'CollectionPage',
          name: `Home Poker Games in ${label}`,
          url: canonical,
          mainEntity: {
            '@type': 'ItemList',
            numberOfItems: playerCount,
          },
        },
        {
          '@type': 'FAQPage',
          mainEntity: faqs.map((f) => ({
            '@type': 'Question',
            name: f.q,
            acceptedAnswer: { '@type': 'Answer', text: f.a },
          })),
        },
      ],
    }).replace(/</g, '\\u003c') +
    '<' + '/script>'
  );
</script>

<svelte:head>
  <link rel="canonical" href={canonical} />
  {#if !indexable}
    <!-- Thin until this city fills in — crawlable, but kept out of the index. -->
    <meta name="robots" content="noindex, follow" />
  {/if}
  {@html jsonLd}
</svelte:head>

<div class="wrap">
  <nav class="text-sm text-muted mb-3">
    <a href="/homegames" class="hover:text-text">Home games</a>
    <span class="mx-1.5 text-faint">/</span>
    <span class="text-text">{label}</span>
  </nav>

  <header class="mb-6">
    <h1 class="text-2xl font-extrabold font-display m-0">Home Poker Games in {label}</h1>
    <p class="text-muted mt-2 max-w-[54ch]">
      {#if playerCount}
        {playerCount} local player{playerCount === 1 ? '' : 's'} on potcount. Find a home game,
        follow the regulars, or start your own table — free, nothing to install.
      {:else}
        No players in {label} yet. Be the first: start a home game and set {label} as your
        city, and this becomes the place locals find you.
      {/if}
    </p>
  </header>

  <!-- Browse a different city -->
  <form class="flex gap-2 mb-8" onsubmit={goCity}>
    <div class="flex-1"><CityPicker bind:value={searchCity} placeholder="Browse another city — e.g. Berlin" /></div>
    <button class="btn btn-secondary shrink-0 no-underline" type="submit">Browse →</button>
  </form>

  {#if openGames.length}
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-3">Open games in {label}</h2>
    <div class="grid gap-2.5 mb-8">
      {#each openGames as g (g.id)}
        <div class="card !mb-0">
          <!-- Title row -->
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold truncate">{g.name}</span>
            {#if g.blinds}<span class="pill !border-accent/45 text-accent shrink-0 tabular-nums">{g.blinds.small}/{g.blinds.big} blinds</span>{/if}
            {#if g.scheduledFor}<span class="pill shrink-0">scheduled</span>{/if}
          </div>

          <!-- Details grid -->
          <div class="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted mt-2 tabular-nums">
            <span>{seatsLabel(g)}</span>
            {#if g.minBuyIn > 0}<span>Buy-in: {buyInLabel(g)}</span>{/if}
          </div>

          <!-- Host note -->
          {#if g.note}
            <p class="text-sm text-muted mt-2 whitespace-pre-wrap">{g.note}</p>
          {/if}

          <!-- Host -->
          {#if g.host}
            <div class="flex items-center gap-2 mt-3 pt-3 border-t border-border-soft">
              {#if g.host.avatar}
                <img src={g.host.avatar} alt="" class="w-6 h-6 rounded-full shrink-0" referrerpolicy="no-referrer" />
              {/if}
              <span class="text-sm text-muted">Hosted by <a href="/u/{g.host.handle}" class="text-text font-semibold hover:text-accent">{g.host.displayName}</a></span>
            </div>
          {/if}

          <!-- Player roster -->
          {#if g.roster.length}
            <div class="flex flex-wrap gap-1.5 mt-2">
              {#each g.roster as p}
                {#if p.handle}
                  <a href="/u/{p.handle}" class="pill no-underline hover:border-accent/50">@{p.handle}</a>
                {:else}
                  <span class="pill">{p.name}</span>
                {/if}
              {/each}
            </div>
          {/if}

          <!-- Join action -->
          <div class="mt-3">
            {#if !user}
              <a href="/account?next=/homegames/{slug}" class="btn-small btn-ghost no-underline">
                Sign in to request a seat
              </a>
            {:else if joinState(g) === 'seated'}
              <span class="text-win text-sm font-semibold">✓ You're in this game.</span>
            {:else if joinState(g) === 'sent'}
              <span class="text-win text-sm font-semibold">✓ Request sent — the host will decide.</span>
            {:else}
              <button class="btn-small btn"
                      disabled={joinState(g) === 'busy'}
                      onclick={() => requestJoin(g.id)}>
                {joinState(g) === 'busy' ? 'Sending…' : 'Request to join'}
              </button>
              {#if joinState(g) !== 'idle' && joinState(g) !== 'busy'}
                <span class="text-danger text-sm ml-2">{joinState(g)}</span>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if playerCount}
    <div class="flex items-baseline justify-between gap-2 mb-3">
      <h2 class="text-sm font-semibold uppercase tracking-widest text-muted m-0">Ranking in {label}</h2>
      <span class="text-faint text-xs">{playerCount} player{playerCount === 1 ? '' : 's'}</span>
    </div>
    {#if topPlayers}
      {#if topPlayers.length}
        <div class="flex flex-col gap-2">
          {#each topPlayers as p (p.handle)}
            <a href="/u/{p.handle}" class="player-row no-underline text-text hover:border-border {p.you ? '!border-accent' : ''}">
              <div class="flex items-center gap-3 min-w-0">
                <span class="w-6 text-center font-bold tabular-nums shrink-0 {p.rank <= 3 ? 'text-base' : 'text-muted'}">{p.rank <= 3 ? ['🥇', '🥈', '🥉'][p.rank - 1] : p.rank}</span>
                <div class="min-w-0">
                  <div class="font-semibold text-[.95rem] truncate">@{p.handle}{#if p.you}<span class="text-muted font-normal"> · you</span>{/if}</div>
                  <div class="text-muted text-xs">{p.games} game{p.games === 1 ? '' : 's'}</div>
                </div>
              </div>
              <div class="font-extrabold tabular-nums shrink-0 {p.net >= 0 ? 'text-win' : 'text-danger'} font-display">{fmtSigned(p.net)}</div>
            </a>
          {/each}
        </div>
        <p class="text-faint text-xs mt-3">Top {topPlayers.length} by all-time profit (in €). Only the top 10 are shown.</p>
      {:else}
        <p class="text-muted text-sm">No ranked players in {label} yet — play a game to get on the board.</p>
      {/if}
    {:else}
      <div class="card">
        <p class="text-muted text-sm m-0"><a href="/account?next=/homegames/{slug}">Sign in</a> to see the top-10 ranking for {label}.</p>
      </div>
    {/if}
  {/if}

  <div class="card mt-8">
    <h2 class="text-base font-bold m-0">Host a game in {label}</h2>
    <p class="text-muted mt-1.5 mb-3">Open a table, share one code, and everyone keeps their own score in real time.</p>
    <a href="/?host=open&city={encodeURIComponent(label)}" class="btn no-underline inline-block">Start a home game</a>
  </div>

  <section class="mt-8">
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-3">Questions</h2>
    {#each faqs as f (f.q)}
      <div class="card !mb-2.5">
        <h3 class="text-base font-semibold m-0">{f.q}</h3>
        <p class="text-muted mt-1.5 mb-0">{f.a}</p>
      </div>
    {/each}
  </section>
</div>
