<script lang="ts">
  import { page } from '$app/stores';

  let { data } = $props();
  const label = $derived(data.label as string);
  const slug = $derived(data.slug as string);
  // Directory is data-minimised: handle only (no real name / photo on the indexed
  // page). Full profile is one click deeper at /u/[handle].
  const players = $derived(data.players as { handle: string }[]);
  const openGames = $derived(
    (data.openGames ?? []) as { id: string; name: string; seated: number; maxPlayers: number; minBuyIn: number; maxBuyIn: number; blinds: { small: number; big: number } | null; scheduledFor: string | null }[]
  );
  const indexable = $derived(data.indexable as boolean);
  const user = $derived($page.data?.user ?? null);

  const canonical = $derived(`https://potcount.com/homegames/${slug}`);

  // Request-to-join state, keyed by game id: 'idle' | 'busy' | 'sent' | error string.
  let reqState = $state<Record<string, string>>({});
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
      a: `Yes. potcount tracks every buy-in and works out who pays who at the end of the night. There's nothing to install and no account needed to join a game.`,
    },
    {
      q: `Can I host my own home game in ${label}?`,
      a: `Absolutely. Open a table, share one code with your friends, and everyone at the table sees their own money in real time.`,
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
            numberOfItems: players.length,
            itemListElement: players.map((p, i) => ({
              '@type': 'ListItem',
              position: i + 1,
              name: `@${p.handle}`,
              url: `https://potcount.com/u/${p.handle}`,
            })),
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
      {#if players.length}
        {players.length} local player{players.length === 1 ? '' : 's'} on potcount. Find a home game,
        follow the regulars, or start your own table — free, nothing to install.
      {:else}
        No players in {label} yet. Be the first: start a home game and set {label} as your
        city, and this becomes the place locals find you.
      {/if}
    </p>
  </header>

  {#if openGames.length}
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-3">Open games in {label}</h2>
    <div class="grid gap-2.5 mb-8">
      {#each openGames as g (g.id)}
        <div class="card !mb-0">
          <div class="flex items-center gap-2">
            <span class="font-semibold truncate">{g.name}</span>
            {#if g.blinds}<span class="pill !border-accent/45 text-accent shrink-0 tabular-nums">{g.blinds.small}/{g.blinds.big}</span>{/if}
            {#if g.scheduledFor}<span class="pill shrink-0">scheduled</span>{/if}
            <span class="ml-auto flex items-center gap-2 shrink-0 text-sm">
              {#if g.minBuyIn > 0}<span class="text-muted tabular-nums">{buyInLabel(g)}</span>{/if}
              <span class="text-muted tabular-nums">{seatsLabel(g)}</span>
            </span>
          </div>
          <div class="mt-3">
            {#if !user}
              <a href="/homegames/{slug}#" class="btn-small btn-ghost no-underline"
                 onclick={(e) => { e.preventDefault(); location.href = '/'; }}>
                Sign in to request a seat
              </a>
            {:else if reqState[g.id] === 'sent'}
              <span class="text-win text-sm font-semibold">✓ Request sent — the host will decide.</span>
            {:else}
              <button class="btn-small btn"
                      disabled={reqState[g.id] === 'busy'}
                      onclick={() => requestJoin(g.id)}>
                {reqState[g.id] === 'busy' ? 'Sending…' : 'Request to join'}
              </button>
              {#if reqState[g.id] && reqState[g.id] !== 'busy'}
                <span class="text-danger text-sm ml-2">{reqState[g.id]}</span>
              {/if}
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}

  {#if players.length}
    <h2 class="text-sm font-semibold uppercase tracking-widest text-muted mb-3">Players in {label}</h2>
    <div class="grid gap-2.5 sm:grid-cols-2">
      {#each players as p (p.handle)}
        <a href="/u/{p.handle}" class="transfer-row no-underline text-text hover:border-border">
          <span class="font-semibold truncate">@{p.handle}</span>
        </a>
      {/each}
    </div>
    <p class="text-faint text-xs mt-3">
      Only usernames are shown here. Tap through to a profile for more. To leave this list,
      set your profile to private or clear your city in <a href="/account">your settings</a>.
    </p>
  {/if}

  <div class="card mt-8">
    <h2 class="text-base font-bold m-0">Host a game in {label}</h2>
    <p class="text-muted mt-1.5 mb-3">Open a table, share one code, and everyone sees their own money in real time.</p>
    <a href="/" class="btn no-underline inline-block">Start a home game</a>
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
